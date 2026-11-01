const { Client } = require('ssh2');
const { WebSocket, WebSocketServer } = require('ws');
const { getSessionUser } = require('./auth');
const { resolveIdentity } = require('./identityResolver');
const { isEphemeralCredentialExpired } = require('./ephemeralCredential');
const { authorizeConnectRequest } = require('./accessPolicy');
const {
  addTimer,
  cleanupSession,
  createSession,
  getSession,
  markReconnectAttempt,
  startSessionSweeper,
  touchSession,
  updateSession,
} = require('./sessionLifecycle');
const { logIdentityEvent } = require('./securityLog');
const { DEFAULT_KEEPALIVE_INTERVAL_MS, createDeadPeerMonitor } = require('./wsKeepalive');

const maxTerminalMessageBytes = 64 * 1024;
const webSocketKeepaliveMs = DEFAULT_KEEPALIVE_INTERVAL_MS;

startSessionSweeper();

function send(ws, type, payload = {}) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

function rejectUpgrade(socket, status, message) {
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\n` +
    'Connection: close\r\n' +
    'Content-Type: text/plain; charset=utf-8\r\n' +
    `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n` +
    message
  );
  socket.destroy();
}

async function getAuthorizedConnection(req, url) {
  const user = await getSessionUser(req);
  if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 });

  const hostId = url.searchParams.get('hostId');
  if (!hostId) throw Object.assign(new Error('Host is required'), { status: 400 });
  const connectToken = url.searchParams.get('connectToken') || url.searchParams.get('token');
  const credentialId = url.searchParams.get('credentialId') || null;
  const authType = url.searchParams.get('authType') || null;
  const purpose = url.searchParams.get('purpose') || 'ssh';
  const authorization = await authorizeConnectRequest(user.id, {
    hostId,
    runtime: 'browser',
    authType,
    credentialId,
    purpose,
    connectToken,
  });
  const resolved = await resolveIdentity({
    userId: user.id,
    hostId: authorization.host.id,
    runtime: authorization.runtime,
    authType: authorization.authType,
    credentialId: authorization.credentialId,
    purpose: authorization.purpose,
    sessionId: url.searchParams.get('sessionId') || null,
  });
  return { ...resolved, host: authorization.host };
}

function readMessage(raw) {
  if (raw.length > maxTerminalMessageBytes) {
    throw new Error('Terminal message is too large');
  }

  const message = JSON.parse(raw.toString('utf8'));
  if (!message || typeof message.type !== 'string') throw new Error('Invalid terminal message');
  return message;
}

function buildConnectConfig(host, material) {
  return {
    host: host.host,
    port: host.port || 22,
    username: host.username,
    password: material?.password || undefined,
    privateKey: material?.privateKey || undefined,
    passphrase: material?.passphrase || undefined,
    cert: material?.certificate || material?.cert || undefined,
    agent: material?.agent || undefined,
    readyTimeout: 15000,
    keepaliveInterval: webSocketKeepaliveMs,
    keepaliveCountMax: 3,
  };
}

function connectShell(ws, resolved) {
  const sessionId = resolved.ephemeralCredential?.sessionId || resolved.host?.id || resolved.hostId || `${Date.now()}`;
  // A client that reconnects after a transport drop reuses its tab id as the session id.
  // If the previous relay session has not been torn down yet (the server has not seen
  // the old socket close), replace it instead of overwriting the map entry and leaking
  // the old ssh2 client.
  if (getSession(sessionId)) {
    markReconnectAttempt(sessionId);
    cleanupSession(sessionId, 'reconnect_replace');
  }
  const session = createSession({
    sessionId,
    userId: resolved.userId,
    hostId: resolved.host?.id || resolved.hostId || null,
    credentialId: resolved.credential?.id || resolved.ephemeralCredential?.id || null,
    runtime: resolved.runtime,
    purpose: resolved.purpose,
    state: 'connecting',
    ws,
    hasClient: true,
  });
  let cleaned = false;
  // Handlers below belong to this session object only. After a reconnect_replace the
  // map entry for sessionId points at a newer session, and a late close from the old
  // ssh2 client must neither report to the new socket nor tear the new session down.
  const isLive = () => !cleaned && getSession(sessionId) === session;
  const cleanupOnce = (reason) => {
    if (cleaned) return;
    cleaned = true;
    if (getSession(sessionId) === session) {
      cleanupSession(sessionId, reason);
    }
  };

  if (!resolved.ephemeralCredential) {
    cleanupOnce('credential_unavailable');
    throw Object.assign(new Error('Credential secret unavailable'), { status: 400 });
  }
  if (isEphemeralCredentialExpired(resolved.ephemeralCredential)) {
    resolved.ephemeralCredential.clear();
    logIdentityEvent('credentialExpired', {
      userId: resolved.userId,
      hostId: resolved.host?.id || resolved.hostId || null,
      credentialId: resolved.credential?.id || resolved.ephemeralCredential.id,
      sessionId: resolved.ephemeralCredential.sessionId,
      runtime: resolved.runtime,
      purpose: resolved.purpose,
      authType: resolved.authType,
      result: 'error',
      timestamp: new Date().toISOString(),
    });
    cleanupOnce('credential_expired');
    throw Object.assign(new Error('Credential secret unavailable'), { status: 400 });
  }

  const conn = new Client();
  let stream = null;
  // Connection outcome tracking, used to tell the client whether a retry makes sense:
  // a drop after the shell was ready is retryable, a failure before ready (auth,
  // policy, unreachable host) is not.
  let reachedReady = false;
  let shellExited = false;
  let closeNotified = false;
  const notifyClosed = (reason, retryable) => {
    if (closeNotified) return;
    closeNotified = true;
    send(ws, 'closed', { reason, retryable: Boolean(retryable) });
  };
  const notifyError = (message, reason, retryable) => {
    if (closeNotified) return;
    closeNotified = true;
    send(ws, 'error', { message, reason, retryable: Boolean(retryable) });
  };

  const monitor = createDeadPeerMonitor(ws, {
    intervalMs: webSocketKeepaliveMs,
    onTick: () => send(ws, 'keepalive'),
    onDead: () => {
      // The client stopped answering pings. Terminate so the TCP half-open state does
      // not keep the ssh2 session alive until the kernel gives up.
      try {
        ws.terminate();
      } catch {
        // Best effort.
      }
      cleanupOnce('ws_dead_peer');
    },
  });
  addTimer(sessionId, monitor.timer, 'keepalive');
  session.conn = conn;
  session.updatedAt = new Date().toISOString();

  ws.on('message', (raw) => {
    try {
      if (!isLive()) return;
      const message = readMessage(raw);
      if (message.type === 'input' && stream && typeof message.data === 'string') {
        stream.write(message.data);
        touchSession(sessionId);
      }
      if (message.type === 'resize' && stream) {
        const cols = Number(message.cols);
        const rows = Number(message.rows);
        if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0) {
          stream.setWindow(rows, cols, 480, 640);
          touchSession(sessionId);
        }
      }
      if (message.type === 'disconnect') {
        cleanupOnce('explicit_disconnect');
        ws.close();
        return;
      }
      if (message.type === 'activity') {
        touchSession(sessionId);
      }
    } catch (error) {
      send(ws, 'error', { message: error.message });
    }
  });

  ws.once('close', () => cleanupOnce('ws_close'));
  ws.once('error', () => cleanupOnce('ws_error'));

  conn.once('ready', () => {
    if (!isLive()) return;
    updateSession(sessionId, { state: 'connected', connectedAt: new Date().toISOString(), hasClient: true, hasStream: true, stream: null });
    conn.shell({ term: 'xterm-256color' }, (error, shell) => {
      if (!isLive()) return;
      if (error) {
        notifyError(error.message, 'shell_error', false);
        ws.close();
        cleanupOnce('shell_error');
        return;
      }

      stream = shell;
      reachedReady = true;
      updateSession(sessionId, { stream: shell, state: 'connected', hasStream: true, hasClient: true, updatedAt: new Date().toISOString() });
      send(ws, 'connected', { sessionId });
      stream.on('data', (data) => {
        if (!isLive()) return;
        touchSession(sessionId);
        send(ws, 'data', { data: data.toString('utf8') });
      });
      stream.once('exit', () => {
        // The remote shell ended on its own (user typed `exit`, or the host killed it).
        // That is a clean close, not a drop, so the client must not auto-reconnect.
        shellExited = true;
      });
      stream.once('close', () => {
        if (!isLive()) return;
        notifyClosed(shellExited ? 'shell_exit' : 'stream_close', !shellExited);
        ws.close();
        cleanupOnce('stream_close');
      });
      stream.once('error', (streamError) => {
        if (!isLive()) return;
        notifyError(streamError.message, 'stream_error', true);
        ws.close();
        cleanupOnce('stream_error');
      });
    });
  });
  conn.once('error', (error) => {
    if (!isLive()) return;
    const retryable = reachedReady && !shellExited;
    notifyError(
      retryable ? `Connection lost: ${error.message}` : 'Connection failed after credential resolution',
      retryable ? 'client_error' : 'connect_error',
      retryable
    );
    logIdentityEvent('credentialUsedForPurpose', {
      userId: resolved.userId,
      hostId: resolved.host?.id || resolved.hostId || null,
      credentialId: resolved.credential?.id || resolved.ephemeralCredential?.id || null,
      sessionId,
      runtime: resolved.runtime,
      purpose: resolved.purpose,
      authType: resolved.authType,
      result: 'error',
      timestamp: new Date().toISOString(),
    });
    ws.close();
    cleanupOnce('client_error');
  });
  conn.once('end', () => {
    if (!isLive()) return;
    notifyClosed(shellExited ? 'shell_exit' : 'client_end', reachedReady && !shellExited);
    ws.close();
    cleanupOnce('client_end');
  });
  conn.once('close', () => {
    if (!isLive()) return;
    notifyClosed(shellExited ? 'shell_exit' : 'client_close', reachedReady && !shellExited);
    ws.close();
    cleanupOnce('client_close');
  });

  const connectConfig = buildConnectConfig(resolved.host, resolved.ephemeralCredential.material);
  try {
    logIdentityEvent('credentialUsedForPurpose', {
      userId: resolved.userId,
      hostId: resolved.host?.id || resolved.hostId || null,
      credentialId: resolved.credential?.id || resolved.ephemeralCredential.id,
      sessionId,
      runtime: resolved.runtime,
      purpose: resolved.purpose,
      authType: resolved.authType,
      result: 'ok',
      timestamp: new Date().toISOString(),
    });
    conn.connect(connectConfig);
  } catch (error) {
    cleanupOnce('connect_throw');
    throw error;
  } finally {
    const cleared = resolved.ephemeralCredential.clear();
    logIdentityEvent(cleared ? 'credentialCleared' : 'credentialClearFailed', {
      userId: resolved.userId,
      hostId: resolved.host?.id || resolved.hostId || null,
      credentialId: resolved.credential?.id || resolved.ephemeralCredential.id,
      sessionId,
      runtime: resolved.runtime,
      purpose: resolved.purpose,
      authType: resolved.authType,
      result: cleared ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
    });
  }
}

function attachSshWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: maxTerminalMessageBytes });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/api/ssh') {
      rejectUpgrade(socket, 404, 'Not found');
      return;
    }

    getAuthorizedConnection(req, url)
      .then((resolved) => {
        wss.handleUpgrade(req, socket, head, (ws) => {
          try {
            connectShell(ws, resolved);
          } catch (error) {
            send(ws, 'error', { message: error.message });
            ws.close();
          }
        });
      })
      .catch((error) => rejectUpgrade(socket, error.status || 500, error.message || 'SSH unavailable'));
  });
}

module.exports = { attachSshWebSocket };
