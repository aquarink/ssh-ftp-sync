const { Client } = require('ssh2');
const { WebSocket, WebSocketServer } = require('ws');
const { getSessionUser } = require('./auth');
const { resolveIdentity } = require('./identityResolver');
const { isEphemeralCredentialExpired } = require('./ephemeralCredential');
const { logIdentityEvent } = require('./securityLog');

const maxTerminalMessageBytes = 64 * 1024;
const webSocketKeepaliveMs = 25000;
const activeSessions = new Map();

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

async function getUserHost(req, url) {
  const user = await getSessionUser(req);
  if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 });

  const hostId = url.searchParams.get('hostId');
  if (!hostId) throw Object.assign(new Error('Host is required'), { status: 400 });
  const credentialId = url.searchParams.get('credentialId') || null;
  const authType = url.searchParams.get('authType') || null;
  const purpose = url.searchParams.get('purpose') || 'ssh';
  const resolved = await resolveIdentity({
    userId: user.id,
    hostId,
    runtime: 'browser',
    authType,
    credentialId,
    purpose,
    sessionId: url.searchParams.get('sessionId') || null,
  });
  return resolved;
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
  if (!resolved.ephemeralCredential) {
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
    throw Object.assign(new Error('Credential secret unavailable'), { status: 400 });
  }

  const conn = new Client();
  let stream = null;
  let finished = false;
  const sessionId = resolved.ephemeralCredential?.sessionId || resolved.host?.id || resolved.hostId || `${Date.now()}`;
  const sessionStartedAt = new Date().toISOString();
  const webSocketKeepalive = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, webSocketKeepaliveMs);

  const finish = () => {
    if (finished) return;
    finished = true;
    clearInterval(webSocketKeepalive);
    stream?.end();
    conn.end();
    activeSessions.delete(sessionId);
  };

  activeSessions.set(sessionId, {
    sessionId,
    userId: resolved.userId,
    hostId: resolved.host?.id || resolved.hostId || null,
    runtime: resolved.runtime,
    purpose: resolved.purpose,
    authType: resolved.authType,
    client: conn,
    stream: null,
    state: 'connecting',
    createdAt: sessionStartedAt,
    updatedAt: sessionStartedAt,
  });

  ws.on('message', (raw) => {
    try {
      const message = readMessage(raw);
      if (message.type === 'input' && stream && typeof message.data === 'string') {
        stream.write(message.data);
      }
      if (message.type === 'resize' && stream) {
        const cols = Number(message.cols);
        const rows = Number(message.rows);
        if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0) {
          stream.setWindow(rows, cols, 480, 640);
        }
      }
    } catch (error) {
      send(ws, 'error', { message: error.message });
    }
  });

  ws.once('close', finish);
  ws.once('error', finish);

  conn.once('ready', () => {
    const session = activeSessions.get(sessionId);
    if (session) {
      session.state = 'ready';
      session.updatedAt = new Date().toISOString();
    }
    conn.shell({ term: 'xterm-256color' }, (error, shell) => {
      if (error) {
        send(ws, 'error', { message: error.message });
        ws.close();
        finish();
        return;
      }

      stream = shell;
      const session = activeSessions.get(sessionId);
      if (session) {
        session.stream = shell;
        session.state = 'active';
        session.updatedAt = new Date().toISOString();
      }
      send(ws, 'connected');
      stream.on('data', (data) => send(ws, 'data', { data: data.toString('utf8') }));
      stream.once('close', () => {
        send(ws, 'closed');
        ws.close();
        finish();
      });
      stream.once('error', (streamError) => {
        send(ws, 'error', { message: streamError.message });
        ws.close();
        finish();
      });
    });
  });
  conn.once('error', (error) => {
    send(ws, 'error', { message: 'Connection failed after credential resolution' });
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
    finish();
  });
  conn.once('end', () => {
    send(ws, 'closed');
    ws.close();
    finish();
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
    activeSessions.delete(sessionId);
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

    getUserHost(req, url)
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
