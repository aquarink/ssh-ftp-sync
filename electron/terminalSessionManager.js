const { Client } = require('ssh2');

class TerminalSessionManager {
  constructor() {
    this.sessions = new Map();
  }

  connect(id, config, handlers) {
    if (this.sessions.has(id)) {
      handlers.onConnected(id);
      return;
    }

    const conn = new Client();
    const session = { conn, stream: null, config };
    this.sessions.set(id, session);

    const cleanup = () => {
      this.sessions.delete(id);
    };

    conn.on('ready', () => {
      handlers.onConnected(id);
      conn.shell({ term: 'xterm-256color' }, (error, stream) => {
        if (error) {
          handlers.onError(id, error);
          conn.end();
          cleanup();
          return;
        }

        session.stream = stream;
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

    conn.connect({
      host: config.host,
      port: config.port || 22,
      username: config.username,
      password: config.password || undefined,
      privateKey: config.privateKey || undefined,
      passphrase: config.passphrase || undefined,
      cert: config.certificate || undefined,
      agent: config.agent || undefined,
      readyTimeout: 15000,
      keepaliveInterval: 25000,
      keepaliveCountMax: 3,
    });
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

  getConfig(id) {
    return this.sessions.get(id)?.config || null;
  }
}

module.exports = { TerminalSessionManager };
