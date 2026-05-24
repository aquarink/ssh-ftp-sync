const { Client } = require('ssh2');
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
    this.sessions = new Map();
  }

  connect(id, config, credential, handlers) {
    if (this.sessions.has(id)) {
      if (credential && !credential.cleared) {
        const cleared = credential.clear();
        logIdentityEvent(cleared ? 'credentialCleared' : 'credentialClearFailed', {
          userId: config.userId || null,
          hostId: config.hostId || null,
          credentialId: credential.id,
          sessionId: credential.sessionId || id,
          runtime: config.runtime || 'electron',
          purpose: config.purpose || 'ssh',
          authType: config.authType || null,
          result: cleared ? 'ok' : 'error',
          timestamp: new Date().toISOString(),
        });
      }
      handlers.onConnected(id);
      return;
    }

    if (!credential) {
      handlers.onError(id, new Error('Credential secret unavailable'));
      return;
    }
    if (isEphemeralCredentialExpired(credential)) {
      credential.clear();
      logIdentityEvent('credentialExpired', {
        userId: config.userId || null,
        hostId: config.hostId || null,
        credentialId: credential.id,
        sessionId: credential.sessionId || id,
        runtime: config.runtime || 'electron',
        purpose: config.purpose || 'ssh',
        authType: config.authType || null,
        result: 'error',
        timestamp: new Date().toISOString(),
      });
      handlers.onError(id, new Error('Credential secret unavailable'));
      return;
    }

    const conn = new Client();
    const session = {
      conn,
      stream: null,
      sessionId: credential.sessionId || id,
      userId: config.userId || null,
      hostId: config.hostId || null,
      runtime: config.runtime || 'electron',
      purpose: config.purpose || 'ssh',
      authType: config.authType || null,
      host: config.host,
      port: config.port || 22,
      username: config.username,
      state: 'connecting',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(id, session);

    const cleanup = () => {
      this.sessions.delete(id);
    };

    conn.on('ready', () => {
      session.state = 'ready';
      session.updatedAt = new Date().toISOString();
      handlers.onConnected(id);
      conn.shell({ term: 'xterm-256color' }, (error, stream) => {
        if (error) {
          handlers.onError(id, error);
          conn.end();
          cleanup();
          return;
        }

        session.stream = stream;
        session.state = 'active';
        session.updatedAt = new Date().toISOString();
        stream.on('close', () => {
          handlers.onClosed(id);
          conn.end();
          cleanup();
        });
        stream.on('data', (data) => handlers.onData(id, data.toString('utf8')));
        stream.on('error', (streamError) => handlers.onError(id, streamError));
      });
    });

    conn.on('error', (error) => {
      handlers.onError(id, error);
      cleanup();
    });
    conn.on('end', () => {
      handlers.onClosed(id);
      cleanup();
    });
    conn.on('close', cleanup);

    try {
      conn.connect(buildConnectConfig(config, credential.material));
    } catch (error) {
      cleanup();
      handlers.onError(id, error);
      throw error;
    } finally {
      const cleared = credential.clear();
      logIdentityEvent(cleared ? 'credentialCleared' : 'credentialClearFailed', {
        userId: config.userId || null,
        hostId: config.hostId || null,
        credentialId: credential.id,
        sessionId: credential.sessionId || id,
        runtime: config.runtime || 'electron',
        purpose: config.purpose || 'ssh',
        authType: config.authType || null,
        result: cleared ? 'ok' : 'error',
        timestamp: new Date().toISOString(),
      });
    }
  }

  write(id, data) {
    this.sessions.get(id)?.stream?.write(data);
  }

  resize(id, cols, rows) {
    const stream = this.sessions.get(id)?.stream;
    if (stream) stream.setWindow(rows, cols, 480, 640);
  }

  disconnect(id) {
    const session = this.sessions.get(id);
    if (!session) return;
    session.stream?.end();
    session.conn.end();
    this.sessions.delete(id);
  }

  getSessionMetadata(id) {
    const session = this.sessions.get(id);
    if (!session) return null;
    const { conn, stream, ...metadata } = session;
    return metadata;
  }
}

module.exports = { TerminalSessionManager };
