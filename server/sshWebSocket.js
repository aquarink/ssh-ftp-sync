const { Client } = require('ssh2');
const { WebSocket, WebSocketServer } = require('ws');
const { getSessionUser } = require('./auth');
const { resolveIdentity } = require('./identityResolver');
const { isEphemeralCredentialExpired } = require('./ephemeralCredential');
const { authorizeConnectRequest } = require('./accessPolicy');
const {
  SESSION_STATE,
  DEFAULT_DETACHED_SESSION_GRACE_MS,
  addTimer,
  cleanupSession,
  createSession,
  getSession,
  markDetachExpired,
  markDetached,
  markReconnectAttempt,
  markResumed,
  startSessionSweeper,
  touchSession,
  updateSession,
} = require('./sessionLifecycle');
const { logIdentityEvent } = require('./securityLog');
const { DEFAULT_KEEPALIVE_INTERVAL_MS, createDeadPeerMonitor } = require('./wsKeepalive');
const { consumeResumeToken, invalidateResumeTokens, issueResumeToken } = require('./resumeToken');

const maxTerminalMessageBytes = 64 * 1024;
const webSocketKeepaliveMs = DEFAULT_KEEPALIVE_INTERVAL_MS;
// How much shell output is kept while a session is detached (no client attached),
// so the gap between a transport drop and a resume can be replayed. Bounded so a
// detached session cannot grow memory without limit.
const outputBufferMaxBytes = Number(process.env.DETACHED_OUTPUT_BUFFER_BYTES || 256 * 1024);
// Resume tokens outlive a single detach so the client can keep trying across the
// grace window; the real bound on a detached session is the grace timer below, not
// this TTL.
const resumeTokenTtlMs = Number(process.env.RESUME_TOKEN_TTL_MS || 3_600_000);
const detachGraceMs = DEFAULT_DETACHED_SESSION_GRACE_MS;

// One controller per live relay session, keyed by sessionId. The controller owns the
// ssh2 client and shell and survives the WebSocket, so a dropped socket can detach and
// a later socket can resume the same shell.
const controllers = new Map();

startSessionSweeper();

function send(ws, type, payload = {}) {
  if (ws && ws.readyState === WebSocket.OPEN) {
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
  // The relay serves the browser runtime and, because the desktop runtime falls
  // back to it when a target is not reachable directly, the Electron runtime too.
  // A connect token is scoped to the runtime it was issued for, so the client
  // states its runtime here and the scope check still applies unchanged.
  const runtime = url.searchParams.get('runtime') === 'electron' ? 'electron' : 'browser';
  const authorization = await authorizeConnectRequest(user.id, {
    hostId,
    runtime,
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
  // The owner of the shell is the authenticated user. The resolver does not return
  // a userId, and resume tokens are scoped to it, so it must be set here.
  return { ...resolved, host: authorization.host, user, userId: user.id };
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

function bufferOutput(ctrl, chunk) {
  ctrl.outputChunks.push(chunk);
  ctrl.outputBytes += chunk.length;
  while (ctrl.outputBytes > outputBufferMaxBytes && ctrl.outputChunks.length > 1) {
    const dropped = ctrl.outputChunks.shift();
    ctrl.outputBytes -= dropped.length;
  }
}

function issueSessionResumeToken(ctrl) {
  const { token, ttlMs } = issueResumeToken({
    userId: ctrl.userId,
    sessionId: ctrl.sessionId,
    ttlMs: resumeTokenTtlMs,
  });
  return { resumeToken: token, resumeGraceSeconds: Math.round(detachGraceMs / 1000), resumeTtlSeconds: Math.round(ttlMs / 1000) };
}

function connectShell(initialWs, resolved) {
  const sessionId = resolved.ephemeralCredential?.sessionId || resolved.host?.id || resolved.hostId || `${Date.now()}`;

  // A fresh connect for a sessionId that already has a controller replaces it: this
  // covers a reconnect that reuses the tab id and a client that connects fresh instead
  // of resuming a detached session.
  const existingController = controllers.get(sessionId);
  if (existingController) {
    existingController.destroy('reconnect_replace');
  } else if (getSession(sessionId)) {
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
    state: SESSION_STATE.CONNECTING,
    ws: initialWs,
    hasClient: true,
  });

  const ctrl = {
    sessionId,
    userId: resolved.userId,
    session,
    conn: new Client(),
    stream: null,
    ws: initialWs,
    monitor: null,
    graceTimer: null,
    outputChunks: [],
    outputBytes: 0,
    reachedReady: false,
    shellExited: false,
    cleaned: false,
    closeNotified: false,
  };
  controllers.set(sessionId, ctrl);

  const isLive = () => !ctrl.cleaned && getSession(sessionId) === session;

  ctrl.destroy = (reason) => {
    if (ctrl.cleaned) return;
    ctrl.cleaned = true;
    if (ctrl.monitor) ctrl.monitor.stop();
    if (ctrl.graceTimer) {
      clearTimeout(ctrl.graceTimer);
      ctrl.graceTimer = null;
    }
    if (controllers.get(sessionId) === ctrl) controllers.delete(sessionId);
    invalidateResumeTokens({ sessionId }, reason || 'closed');
    if (getSession(sessionId) === session) {
      cleanupSession(sessionId, reason);
    }
  };

  const notifyClosed = (reason, retryable) => {
    if (ctrl.closeNotified) return;
    ctrl.closeNotified = true;
    send(ctrl.ws, 'closed', { reason, retryable: Boolean(retryable) });
  };
  const notifyError = (message, reason, retryable) => {
    if (ctrl.closeNotified) return;
    ctrl.closeNotified = true;
    send(ctrl.ws, 'error', { message, reason, retryable: Boolean(retryable) });
  };

  // Hold a shell whose client went away, instead of tearing it down, for a bounded
  // grace period. The ssh2 connection stays open and output is buffered for replay.
  const detach = (reason) => {
    if (ctrl.cleaned || ctrl.session.state === SESSION_STATE.DETACHED) return;
    if (!ctrl.reachedReady || ctrl.shellExited) {
      // Nothing resumable: no shell ever existed, or it exited cleanly.
      ctrl.destroy(reason);
      return;
    }
    if (ctrl.monitor) {
      ctrl.monitor.stop();
      ctrl.monitor = null;
    }
    ctrl.ws = null;
    ctrl.closeNotified = false;
    markDetached(sessionId, reason);
    ctrl.graceTimer = setTimeout(() => {
      ctrl.graceTimer = null;
      if (ctrl.session.state === SESSION_STATE.DETACHED) {
        markDetachExpired(sessionId);
        ctrl.destroy('detached_expired');
      }
    }, detachGraceMs);
    if (typeof ctrl.graceTimer.unref === 'function') ctrl.graceTimer.unref();
  };

  const onWsClose = (closingWs) => {
    if (ctrl.ws !== closingWs) return; // a stale socket we already replaced
    if (ctrl.cleaned) return;
    // A transport drop with a live shell detaches; anything else tears down.
    detach('ws_close');
  };

  const attachWs = (ws) => {
    ctrl.ws = ws;
    ctrl.monitor = createDeadPeerMonitor(ws, {
      intervalMs: webSocketKeepaliveMs,
      onTick: () => send(ws, 'keepalive'),
      onDead: () => {
        // The client stopped answering pings; drop the socket so the grace/detach
        // path runs instead of holding a half-open connection.
        try {
          ws.terminate();
        } catch {
          // Best effort.
        }
      },
    });
    addTimer(sessionId, ctrl.monitor.timer, 'keepalive');

    ws.on('message', (raw) => {
      try {
        if (!isLive()) return;
        const message = readMessage(raw);
        if (message.type === 'input' && ctrl.stream && typeof message.data === 'string') {
          ctrl.stream.write(message.data);
          touchSession(sessionId);
        }
        if (message.type === 'resize' && ctrl.stream) {
          const cols = Number(message.cols);
          const rows = Number(message.rows);
          if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0) {
            ctrl.stream.setWindow(rows, cols, 480, 640);
            touchSession(sessionId);
          }
        }
        if (message.type === 'disconnect') {
          notifyClosed('explicit_disconnect', false);
          ctrl.destroy('explicit_disconnect');
          try { ws.close(); } catch { /* ignore */ }
          return;
        }
        if (message.type === 'activity') {
          touchSession(sessionId);
        }
      } catch (error) {
        send(ctrl.ws, 'error', { message: error.message });
      }
    });

    ws.once('close', () => onWsClose(ws));
    ws.once('error', () => onWsClose(ws));
  };

  // Attach the shell output handlers once; they follow the controller's current ws
  // and buffer output while detached.
  const wireStream = (shell) => {
    ctrl.stream = shell;
    ctrl.reachedReady = true;
    updateSession(sessionId, { stream: shell, state: SESSION_STATE.CONNECTED, hasStream: true, hasClient: true, updatedAt: new Date().toISOString() });
    const resumeInfo = issueSessionResumeToken(ctrl);
    send(ctrl.ws, 'connected', { sessionId, ...resumeInfo });

    shell.on('data', (data) => {
      if (ctrl.cleaned) return;
      touchSession(sessionId);
      if (ctrl.ws && ctrl.ws.readyState === WebSocket.OPEN) {
        send(ctrl.ws, 'data', { data: data.toString('utf8') });
      } else {
        bufferOutput(ctrl, Buffer.from(data));
      }
    });
    shell.once('exit', () => {
      ctrl.shellExited = true;
    });
    shell.once('close', () => {
      if (ctrl.cleaned) return;
      notifyClosed(ctrl.shellExited ? 'shell_exit' : 'stream_close', !ctrl.shellExited);
      try { if (ctrl.ws) ctrl.ws.close(); } catch { /* ignore */ }
      ctrl.destroy('stream_close');
    });
    shell.once('error', (streamError) => {
      if (ctrl.cleaned) return;
      notifyError(streamError.message, 'stream_error', true);
      try { if (ctrl.ws) ctrl.ws.close(); } catch { /* ignore */ }
      ctrl.destroy('stream_error');
    });
  };

  if (!resolved.ephemeralCredential) {
    ctrl.destroy('credential_unavailable');
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
    ctrl.destroy('credential_expired');
    throw Object.assign(new Error('Credential secret unavailable'), { status: 400 });
  }

  const conn = ctrl.conn;
  session.conn = conn;
  session.updatedAt = new Date().toISOString();

  attachWs(initialWs);

  conn.once('ready', () => {
    if (!isLive()) return;
    updateSession(sessionId, { state: SESSION_STATE.CONNECTED, connectedAt: new Date().toISOString(), hasClient: true, hasStream: true });
    conn.shell({ term: 'xterm-256color' }, (error, shell) => {
      if (!isLive()) return;
      if (error) {
        notifyError(error.message, 'shell_error', false);
        try { if (ctrl.ws) ctrl.ws.close(); } catch { /* ignore */ }
        ctrl.destroy('shell_error');
        return;
      }
      wireStream(shell);
    });
  });
  conn.once('error', (error) => {
    if (ctrl.cleaned) return;
    const retryable = ctrl.reachedReady && !ctrl.shellExited;
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
    try { if (ctrl.ws) ctrl.ws.close(); } catch { /* ignore */ }
    ctrl.destroy('client_error');
  });
  conn.once('end', () => {
    if (ctrl.cleaned) return;
    notifyClosed(ctrl.shellExited ? 'shell_exit' : 'client_end', ctrl.reachedReady && !ctrl.shellExited);
    try { if (ctrl.ws) ctrl.ws.close(); } catch { /* ignore */ }
    ctrl.destroy('client_end');
  });
  conn.once('close', () => {
    if (ctrl.cleaned) return;
    notifyClosed(ctrl.shellExited ? 'shell_exit' : 'client_close', ctrl.reachedReady && !ctrl.shellExited);
    try { if (ctrl.ws) ctrl.ws.close(); } catch { /* ignore */ }
    ctrl.destroy('client_close');
  });

  ctrl.resume = (ws) => {
    // The previous socket may still be attached if the relay has not yet noticed
    // it went half-open (see resumeSession). The valid one-time resume token
    // proves the legitimate client is back, so replace the stale socket instead
    // of refusing. detach() stops its keepalive monitor and marks the session
    // DETACHED; its later 'close' event is ignored because ctrl.ws has moved on.
    if (ctrl.ws && ctrl.ws !== ws) {
      const stale = ctrl.ws;
      detach('socket_replaced');
      try {
        stale.terminate();
      } catch {
        // Best effort; the socket may already be gone.
      }
    }
    if (ctrl.cleaned || ctrl.session.state !== SESSION_STATE.DETACHED) {
      // The shell went away between validation and resume (e.g. it exited).
      throw new Error('Session ended before it could be resumed');
    }
    markResumed(sessionId, ws);
    if (ctrl.graceTimer) {
      clearTimeout(ctrl.graceTimer);
      ctrl.graceTimer = null;
    }
    ctrl.closeNotified = false;
    attachWs(ws);
    const resumeInfo = issueSessionResumeToken(ctrl);
    send(ws, 'resumed', { sessionId, ...resumeInfo });
    // Replay output buffered during the detach so the terminal catches up.
    if (ctrl.outputBytes > 0) {
      const replay = Buffer.concat(ctrl.outputChunks).toString('utf8');
      ctrl.outputChunks = [];
      ctrl.outputBytes = 0;
      send(ws, 'data', { data: replay });
    }
  };

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
    ctrl.destroy('connect_throw');
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

async function resumeSession(req, url) {
  const user = await getSessionUser(req);
  if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 });

  const sessionId = url.searchParams.get('resume');
  const resumeToken = url.searchParams.get('resumeToken') || url.searchParams.get('token');
  if (!sessionId || !resumeToken) {
    throw Object.assign(new Error('Resume authorization required'), { status: 400 });
  }

  const ctrl = controllers.get(sessionId);
  const session = getSession(sessionId);
  // Validate the session is resumable before consuming the one-time token, so a
  // token is not burned when there is nothing to resume.
  //
  // A session is resumable when it is DETACHED, or when it is still CONNECTED
  // with a live shell: in a multi-hop deployment (browser -> edge proxy -> relay)
  // the relay's leg stays up when the client's network drops, so the relay only
  // learns about the drop through missed pongs. A client that comes back before
  // that and presents a valid resume token must be allowed to replace the stale
  // socket, otherwise exactly the short drops the feature exists for would fall
  // back to a fresh shell. This does not widen the trust boundary: the token is
  // one-time, bound to this user and session, and the request must also carry the
  // user's own authenticated cookie, which already lets them open new sessions.
  const resumable = Boolean(ctrl && session)
    && (session.state === SESSION_STATE.DETACHED
      || (session.state === SESSION_STATE.CONNECTED && ctrl.reachedReady && !ctrl.shellExited));
  if (!ctrl || !session || session.userId !== user.id || !resumable) {
    throw Object.assign(new Error('Session is not resumable'), { status: 409 });
  }

  consumeResumeToken(resumeToken, { userId: user.id, sessionId });
  return ctrl;
}

function attachSshWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: maxTerminalMessageBytes });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/api/ssh') {
      rejectUpgrade(socket, 404, 'Not found');
      return;
    }

    if (url.searchParams.get('resume')) {
      resumeSession(req, url)
        .then((ctrl) => {
          wss.handleUpgrade(req, socket, head, (ws) => {
            try {
              ctrl.resume(ws);
            } catch (error) {
              send(ws, 'error', { message: error.message, reason: 'resume_failed', retryable: true });
              ws.close();
            }
          });
        })
        .catch((error) => rejectUpgrade(socket, error.status || 500, error.message || 'Resume unavailable'));
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
