const { Client } = require('ssh2');
const {
  cleanupSession,
  createSession,
  getSession,
  markReconnectAttempt,
  startSessionSweeper,
  touchSession,
  updateSession,
} = require('./sessionLifecycle');
const { isEphemeralCredentialExpired } = require('./ephemeralCredential');
const { logIdentityEvent } = require('./securityLog');

function buildConnectConfig(config, material) {
  return {
    host: config.host,
    port: config.port || 22,
    username: config.username,
    password: material?.password || undefined,
    privateKey: material?.privateKey || undefined,
    passphrase: material?.passphrase || undefined,
    cert: material?.certificate || material?.cert || undefined,
    agent: material?.agent || undefined,
    readyTimeout: 15000,
    keepaliveInterval: 25000,
    keepaliveCountMax: 3,
  };
}

class TerminalSessionManager {
  constructor() {
    startSessionSweeper();
  }

  connect(id, config, credential, handlers, meta = {}) {
    const existingSession = getSession(id);
    if (existingSession) {
      markReconnectAttempt(id);
      cleanupSession(id, 'reconnect_replace');
    }

    if (!credential) {
      handlers.onError(id, new Error('Credential secret unavailable'));
      return null;
    }
    if (isEphemeralCredentialExpired(credential)) {
      credential.clear();
      logIdentityEvent('credentialExpired', {
        userId: config.userId || null,
        hostId: config.hostId || null,
        credentialId: config.credentialId || credential.id,
        sessionId: credential.sessionId || id,
        runtime: config.runtime || 'electron',
        purpose: config.purpose || 'ssh',
        authType: config.authType || null,
        result: 'error',
        timestamp: new Date().toISOString(),
      });
      handlers.onError(id, new Error('Credential secret unavailable'));
      return null;
    }

    const conn = new Client();
    const session = createSession({
      sessionId: id,
      userId: config.userId || null,
      hostId: config.hostId || null,
      credentialId: config.credentialId || credential.id || null,
      runtime: config.runtime || 'electron',
      purpose: config.purpose || 'ssh',
      authType: config.authType || null,
      windowId: meta.windowId || null,
      state: 'connecting',
      conn,
      hasClient: true,
    });

    const cleanup = (reason) => cleanupSession(id, reason);
    // Only the session object created by this connect() call may report events to
    // the renderer. When a tab reconnects with the same id, cleanup of the previous
    // session ends its stream asynchronously; without this guard that late 'close'
    // would be reported against the new attempt.
    const isLive = () => getSession(id) === session && !session.cleanupInProgress;

    // Outcome tracking for the renderer's reconnect policy: a drop after the shell
    // was ready is retryable, a failure before ready (auth, unreachable host) is not,
    // and a shell that exited on its own is a clean close.
    let reachedReady = false;
    let shellExited = false;
    let closeNotified = false;
    const notifyClosed = (reason) => {
      if (closeNotified) return;
      closeNotified = true;
      handlers.onClosed(id, {
        reason: shellExited ? 'shell_exit' : reason,
        retryable: reachedReady && !shellExited,
      });
    };
    const notifyError = (error, reason, retryable) => {
      if (closeNotified) return;
      closeNotified = true;
      handlers.onError(id, error, { reason, retryable: Boolean(retryable) });
    };

    conn.on('ready', () => {
      if (!isLive()) return;
      updateSession(id, { state: 'connected', connectedAt: new Date().toISOString(), hasClient: true });
      conn.shell({ term: 'xterm-256color' }, (error, stream) => {
        if (!isLive()) return;
        if (error) {
          notifyError(error, 'shell_error', false);
          cleanup('shell_error');
          return;
        }

        session.stream = stream;
        reachedReady = true;
        updateSession(id, { stream, hasStream: true, state: 'connected' });
        handlers.onConnected(id);
        stream.on('data', (data) => {
          if (!isLive()) return;
          touchSession(id);
          handlers.onData(id, data.toString('utf8'));
        });
        stream.once('exit', () => {
          shellExited = true;
        });
        stream.on('close', () => {
          if (!isLive()) return;
          notifyClosed('stream_close');
          cleanup('stream_close');
        });
        stream.on('end', () => {
          if (!isLive()) return;
          notifyClosed('stream_end');
          cleanup('stream_end');
        });
        stream.on('error', (streamError) => {
          if (!isLive()) return;
          notifyError(streamError, 'stream_error', true);
          cleanup('stream_error');
        });
      });
    });

    conn.on('error', (error) => {
      if (!isLive()) return;
      notifyError(error, reachedReady ? 'client_error' : 'connect_error', reachedReady && !shellExited);
      cleanup('client_error');
    });
    conn.on('end', () => {
      if (!isLive()) return;
      notifyClosed('client_end');
      cleanup('client_end');
    });
    conn.on('close', () => {
      if (!isLive()) return;
      notifyClosed('client_close');
      cleanup('client_close');
    });

    try {
      conn.connect(buildConnectConfig(config, credential.material));
    } catch (error) {
      cleanup('connect_throw');
      handlers.onError(id, error);
      throw error;
    } finally {
      const cleared = credential.clear();
      logIdentityEvent(cleared ? 'credentialCleared' : 'credentialClearFailed', {
        userId: config.userId || null,
        hostId: config.hostId || null,
        credentialId: config.credentialId || credential.id,
        sessionId: credential.sessionId || id,
        runtime: config.runtime || 'electron',
        purpose: config.purpose || 'ssh',
        authType: config.authType || null,
        result: cleared ? 'ok' : 'error',
        timestamp: new Date().toISOString(),
      });
    }

    return session;
  }

  write(id, data) {
    const session = getSession(id);
    if (!session?.stream) return;
    touchSession(id);
    session.stream.write(data);
  }

  resize(id, cols, rows) {
    const session = getSession(id);
    if (!session?.stream) return;
    touchSession(id);
    session.stream.setWindow(rows, cols, 480, 640);
  }

  disconnect(id, reason = 'tab_close') {
    cleanupSession(id, reason);
  }

  getSessionMetadata(id) {
    const session = getSession(id);
    if (!session) return null;
    const { conn, stream, ws, sftp, timers, listenerCleanups, cleanupInProgress, cleanupDone, ...metadata } = session;
    return metadata;
  }
}

module.exports = { TerminalSessionManager };
