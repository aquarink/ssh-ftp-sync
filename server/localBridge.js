const net = require('net');
const { createHash } = require('crypto');
const { classifyTargetHost, isLoopbackAddress, isUnspecifiedAddress } = require('./accessPolicy');
const { logAccessEvent } = require('./securityLog');

function sessionLogId(token) {
  return createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
}

class LocalBridgeSessionManager {
  constructor() {
    this.sessions = new Map();
  }

  createSession(token, targetHost, targetPort, options = {}) {
    if (!token) {
      throw new Error('Local bridge session requires a scoped token');
    }

    const host = String(targetHost || '').trim().toLowerCase();
    const port = Number(targetPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Local bridge target port must be a valid TCP port');
    }

    const targetClass = classifyTargetHost(host);
    if (targetClass === 'WILDCARD_INVALID' || isUnspecifiedAddress(host)) {
      throw new Error('Unspecified or wildcard target addresses (0.0.0.0 / ::) are not allowed');
    }

    if (targetClass !== 'LOOPBACK' && targetClass !== 'PRIVATE_LAN') {
      throw new Error('Local bridge supports only client-local loopback or private LAN targets');
    }

    if (options.approved !== true) {
      throw new Error('Local bridge requires explicit per-target approval');
    }

    const ttlMs = options.ttlMs || 30_000;

    if (this.sessions.has(token)) {
      this.cleanupSession(token);
    }

    const logId = sessionLogId(token);
    const session = {
      token,
      logId,
      targetHost: host,
      targetPort: port,
      sockets: new Set(),
      listener: null,
      localPort: null,
    };

    const bindHost = options.bindHost || '127.0.0.1';
    if (isUnspecifiedAddress(bindHost) || !isLoopbackAddress(bindHost)) {
      throw new Error('Local bridge listener must bind only to a loopback address');
    }

    const server = net.createServer((localSocket) => {
      session.sockets.add(localSocket);

      logAccessEvent('bridge_connection_attempt', {
        bridgeSessionId: logId,
        targetHost: host,
        targetPort: port,
        targetClass,
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
      localSocket.on('error', () => {
        cleanupSockets();
      });
      remoteSocket.on('error', () => {
        cleanupSockets();
      });
    });

    session.listener = server;

    // Timeout-based TTL cleanup
    session.ttlTimer = setTimeout(() => {
      logAccessEvent('bridge_session_ttl_expired', {
        bridgeSessionId: logId,
        targetHost: host,
        targetPort: port,
        targetClass,
        timestamp: new Date().toISOString()
      });
      this.cleanupSession(token);
    }, ttlMs);

    this.sessions.set(token, session);

    return new Promise((resolve, reject) => {
      server.listen(0, bindHost, () => {
        session.localPort = server.address().port;
        logAccessEvent('bridge_session_created', {
          bridgeSessionId: logId,
          targetHost: host,
          targetPort: port,
          targetClass,
          localPort: session.localPort,
          timestamp: new Date().toISOString()
        });
        resolve(session);
      });

      server.on('error', (err) => {
        this.cleanupSession(token);
        reject(err);
      });
    });
  }

  cleanupSession(token) {
    const session = this.sessions.get(token);
    if (!session) return;

    clearTimeout(session.ttlTimer);

    for (const socket of session.sockets) {
      try {
        socket.destroy();
      } catch (e) {}
    }
    session.sockets.clear();

    if (session.listener) {
      try {
        session.listener.close();
      } catch (e) {}
    }

    this.sessions.delete(token);

    logAccessEvent('bridge_session_cleaned_up', {
      bridgeSessionId: session.logId,
      targetHost: session.targetHost,
      targetPort: session.targetPort,
      targetClass: classifyTargetHost(session.targetHost),
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
