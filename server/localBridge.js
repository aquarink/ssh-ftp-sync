const net = require('net');
const { isLoopbackAddress } = require('./accessPolicy');
const { logAccessEvent } = require('./securityLog');

class LocalBridgeSessionManager {
  constructor() {
    this.sessions = new Map();
  }

  createSession(token, targetHost, targetPort, options = {}) {
    const host = String(targetHost || '').trim().toLowerCase();
    const port = Number(targetPort);

    // 1. Loopback checks (must reject unspecified/wildcard addresses and non-loopback addresses)
    if (host === '0.0.0.0' || host === '::' || host === '[::]') {
      throw new Error('Unspecified or wildcard target addresses (0.0.0.0 / ::) are not allowed');
    }

    if (!isLoopbackAddress(host)) {
      throw new Error('Local bridge is restricted to loopback targets only');
    }

    // 2. Short TTL (default to 30 seconds)
    const ttlMs = options.ttlMs || 30_000;

    // Clean up existing session if any
    if (this.sessions.has(token)) {
      this.cleanupSession(token);
    }

    const session = {
      token,
      targetHost: host,
      targetPort: port,
      sockets: new Set(),
      listener: null,
      localPort: null,
    };

    // 3. Loopback-only listener (listen on 127.0.0.1 or ::1)
    const bindHost = options.bindHost || '127.0.0.1';
    if (!isLoopbackAddress(bindHost) || bindHost === '0.0.0.0' || bindHost === '::') {
      throw new Error('Local bridge listener must bind only to a loopback address');
    }

    const server = net.createServer((localSocket) => {
      session.sockets.add(localSocket);

      // Metadata-only log
      logAccessEvent('bridge_connection_attempt', {
        token: token.substring(0, 8) + '...',
        targetHost: host,
        targetPort: port,
        timestamp: new Date().toISOString()
      });

      const remoteSocket = net.connect({ host, port }, () => {
        localSocket.pipe(remoteSocket).pipe(localSocket);
      });

      session.sockets.add(remoteSocket);

      const cleanupSockets = () => {
        session.sockets.delete(localSocket);
        session.sockets.delete(remoteSocket);
        localSocket.destroy();
        remoteSocket.destroy();
      };

      localSocket.on('close', cleanupSockets);
      remoteSocket.on('close', cleanupSockets);
      localSocket.on('error', (err) => {
        cleanupSockets();
      });
      remoteSocket.on('error', (err) => {
        cleanupSockets();
      });
    });

    session.listener = server;

    // Timeout-based TTL cleanup
    session.ttlTimer = setTimeout(() => {
      logAccessEvent('bridge_session_ttl_expired', {
        token: token.substring(0, 8) + '...',
        targetHost: host,
        targetPort: port,
        timestamp: new Date().toISOString()
      });
      this.cleanupSession(token);
    }, ttlMs);

    this.sessions.set(token, session);

    return new Promise((resolve, reject) => {
      server.listen(0, bindHost, () => {
        session.localPort = server.address().port;
        logAccessEvent('bridge_session_created', {
          token: token.substring(0, 8) + '...',
          targetHost: host,
          targetPort: port,
          localPort: session.localPort,
          timestamp: new Date().toISOString()
        });
        resolve(session);
      });

      server.on('error', (err) => {
        clearTimeout(session.ttlTimer);
        reject(err);
      });
    });
  }

  cleanupSession(token) {
    const session = this.sessions.get(token);
    if (!session) return;

    clearTimeout(session.ttlTimer);

    // Close all sockets
    for (const socket of session.sockets) {
      try {
        socket.destroy();
      } catch (e) {}
    }
    session.sockets.clear();

    // Close listener
    if (session.listener) {
      try {
        session.listener.close();
      } catch (e) {}
    }

    this.sessions.delete(token);

    logAccessEvent('bridge_session_cleaned_up', {
      token: token.substring(0, 8) + '...',
      targetHost: session.targetHost,
      targetPort: session.targetPort,
      timestamp: new Date().toISOString()
    });
  }

  cleanupAll() {
    for (const token of this.sessions.keys()) {
      this.cleanupSession(token);
    }
  }
}

const localBridgeSessionManager = new LocalBridgeSessionManager();

module.exports = {
  LocalBridgeSessionManager,
  localBridgeSessionManager,
};
