const { WebSocket } = require('ws');

const SESSION_STATE = {
  CREATING: 'creating',
  RESOLVING_IDENTITY: 'resolving_identity',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  CLOSING: 'closing',
  CLOSED: 'closed',
  FAILED: 'failed',
};

const DEFAULT_SESSION_SWEEPER_INTERVAL_MS = Number(process.env.SESSION_SWEEPER_INTERVAL_MS || 60000);
const DEFAULT_STALE_PENDING_SESSION_MS = Number(process.env.STALE_PENDING_SESSION_MS || 120000);
const DEFAULT_STALE_CONNECTED_SESSION_MS = Number(process.env.STALE_CONNECTED_SESSION_MS || 1800000);

const sessions = new Map();
const metrics = {
  activeSessions: 0,
  sessionsCreated: 0,
  sessionsClosed: 0,
  cleanupCalls: 0,
  cleanupDuplicateCalls: 0,
  staleSessionsCleaned: 0,
  reconnectAttempts: 0,
  cleanupErrors: 0,
};

let sweeperHandle = null;
let sweeperRunning = false;

function nowIso() {
  return new Date().toISOString();
}

function logSessionEvent(event, session, extra = {}) {
  console.info('[session]', event, {
    sessionId: session?.sessionId || null,
    userId: session?.userId || null,
    hostId: session?.hostId || null,
    runtime: session?.runtime || null,
    purpose: session?.purpose || null,
    state: session?.state || null,
    closeReason: session?.closeReason || null,
    result: extra.result || null,
    timestamp: nowIso(),
  });
}

function registerTimer(session, timer, label) {
  if (!session || !timer) return timer;
  if (!session.timers) session.timers = new Set();
  session.timers.add({ timer, label });
  return timer;
}

function clearTimers(session) {
  if (!session?.timers) return;
  for (const entry of session.timers) {
    try {
      clearTimeout(entry.timer);
      clearInterval(entry.timer);
    } catch {
      // Best effort.
    }
  }
  session.timers.clear();
}

function safeRemoveListener(target, event, handler) {
  if (!target || !handler) return;
  try {
    if (typeof target.off === 'function') target.off(event, handler);
    else if (typeof target.removeListener === 'function') target.removeListener(event, handler);
  } catch {
    // Best effort.
  }
}

function detachListeners(session) {
  if (!session) return;
  for (const cleanup of session.listenerCleanups || []) {
    try {
      cleanup();
    } catch {
      // Best effort.
    }
  }
  session.listenerCleanups = [];
}

function safeCloseSocket(ws) {
  if (!ws) return;
  try {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
      ws.close();
    }
  } catch {
    // Best effort.
  }
}

function safeShutdown(value, methodNames) {
  if (!value) return;
  for (const methodName of methodNames) {
    try {
      if (typeof value[methodName] === 'function') {
        value[methodName]();
        return;
      }
    } catch {
      // Try the next method.
    }
  }
}

function createSession({
  sessionId,
  userId = null,
  hostId = null,
  credentialId = null,
  runtime = 'browser',
  purpose = 'ssh',
  state = SESSION_STATE.CREATING,
  windowId = null,
  reconnectAttempt = 0,
  ws = null,
  conn = null,
  stream = null,
  sftp = null,
  hasStream = false,
  hasClient = false,
} = {}) {
  const createdAt = nowIso();
  const session = {
    sessionId,
    userId,
    hostId,
    credentialId,
    runtime,
    purpose,
    state,
    windowId,
    reconnectAttempt,
    createdAt,
    connectedAt: null,
    lastActivityAt: createdAt,
    closingAt: null,
    closedAt: null,
    closeReason: null,
    hasStream: Boolean(hasStream),
    hasClient: Boolean(hasClient),
    ws,
    conn,
    stream,
    sftp,
    timers: new Set(),
    listenerCleanups: [],
    cleanupInProgress: false,
    cleanupDone: false,
  };
  sessions.set(sessionId, session);
  metrics.sessionsCreated += 1;
  metrics.activeSessions = sessions.size;
  logSessionEvent('created', session, { result: 'ok' });
  return session;
}

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

function updateSession(sessionId, patch = {}) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  Object.assign(session, patch);
  session.lastActivityAt = patch.lastActivityAt || nowIso();
  return session;
}

function touchSession(sessionId) {
  return updateSession(sessionId, { lastActivityAt: nowIso() });
}

function addListenerCleanup(sessionId, cleanup) {
  const session = sessions.get(sessionId);
  if (!session || typeof cleanup !== 'function') return;
  session.listenerCleanups.push(cleanup);
}

function addTimer(sessionId, timer, label) {
  const session = sessions.get(sessionId);
  if (!session || !timer) return timer;
  registerTimer(session, timer, label);
  return timer;
}

function cleanupSession(sessionId, reason = 'unknown') {
  const session = sessions.get(sessionId);
  metrics.cleanupCalls += 1;
  if (!session) {
    metrics.cleanupDuplicateCalls += 1;
    return false;
  }
  if (session.cleanupInProgress || session.state === SESSION_STATE.CLOSED) {
    metrics.cleanupDuplicateCalls += 1;
    return false;
  }

  session.cleanupInProgress = true;
  session.state = SESSION_STATE.CLOSING;
  session.closeReason = reason;
  session.closingAt = nowIso();
  logSessionEvent('closing', session, { result: 'ok' });

  try {
    detachListeners(session);
    clearTimers(session);
    safeShutdown(session.stream, ['end', 'close', 'destroy']);
    safeShutdown(session.sftp, ['end', 'close', 'destroy']);
    safeShutdown(session.conn, ['end', 'close', 'destroy']);
    safeCloseSocket(session.ws);
  } catch (error) {
    metrics.cleanupErrors += 1;
    logSessionEvent('cleanup-error', session, { result: 'error' });
  } finally {
    try {
      session.hasStream = false;
      session.hasClient = false;
      session.stream = null;
      session.sftp = null;
      session.conn = null;
      session.ws = null;
      session.state = SESSION_STATE.CLOSED;
      session.closedAt = nowIso();
      session.cleanupDone = true;
      sessions.delete(sessionId);
      metrics.sessionsClosed += 1;
      metrics.activeSessions = sessions.size;
      logSessionEvent('closed', session, { result: 'ok' });
    } catch (error) {
      metrics.cleanupErrors += 1;
      logSessionEvent('cleanup-error', session, { result: 'error' });
    }
  }

  return true;
}

function cleanupSessionsByUser(userId, reason = 'user_cleanup') {
  for (const session of sessions.values()) {
    if (session.userId === userId) {
      cleanupSession(session.sessionId, reason);
    }
  }
}

function cleanupAllSessions(reason = 'global_cleanup') {
  for (const session of [...sessions.values()]) {
    cleanupSession(session.sessionId, reason);
  }
}

function markReconnectAttempt(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  session.reconnectAttempt = (session.reconnectAttempt || 0) + 1;
  session.state = SESSION_STATE.RECONNECTING;
  session.lastActivityAt = nowIso();
  metrics.reconnectAttempts += 1;
  logSessionEvent('reconnect-attempt', session, { result: 'ok' });
  return session;
}

function getSessionMetrics() {
  return { ...metrics };
}

function isSessionStale(session, now = Date.now()) {
  const createdAt = Date.parse(session.createdAt);
  const lastActivityAt = Date.parse(session.lastActivityAt || session.createdAt);
  if (session.state === SESSION_STATE.CREATING || session.state === SESSION_STATE.CONNECTING || session.state === SESSION_STATE.RESOLVING_IDENTITY || session.state === SESSION_STATE.RECONNECTING) {
    return now - Math.max(createdAt, lastActivityAt) > DEFAULT_STALE_PENDING_SESSION_MS;
  }
  if (session.state !== SESSION_STATE.CONNECTED && session.state !== SESSION_STATE.CLOSED) {
    return now - Math.max(createdAt, lastActivityAt) > DEFAULT_STALE_CONNECTED_SESSION_MS;
  }
  if (!session.conn && !session.stream && !session.ws) {
    return true;
  }
  return false;
}

function sweepStaleSessions() {
  const now = Date.now();
  for (const session of [...sessions.values()]) {
    if (session.state === SESSION_STATE.CONNECTED && session.conn && session.stream) {
      continue;
    }
    if (isSessionStale(session, now)) {
      metrics.staleSessionsCleaned += 1;
      cleanupSession(session.sessionId, 'stale_sweeper');
    }
  }
}

function startSessionSweeper() {
  if (sweeperHandle) return sweeperHandle;
  if (sweeperRunning) return null;
  sweeperRunning = true;
  sweeperHandle = setInterval(() => {
    try {
      sweepStaleSessions();
    } catch {
      // Best effort sweeper.
    }
  }, DEFAULT_SESSION_SWEEPER_INTERVAL_MS);
  if (typeof sweeperHandle.unref === 'function') {
    sweeperHandle.unref();
  }
  return sweeperHandle;
}

module.exports = {
  SESSION_STATE,
  DEFAULT_SESSION_SWEEPER_INTERVAL_MS,
  DEFAULT_STALE_PENDING_SESSION_MS,
  DEFAULT_STALE_CONNECTED_SESSION_MS,
  addListenerCleanup,
  addTimer,
  cleanupAllSessions,
  cleanupSession,
  cleanupSessionsByUser,
  createSession,
  getSession,
  getSessionMetrics,
  markReconnectAttempt,
  startSessionSweeper,
  sweepStaleSessions,
  touchSession,
  updateSession,
};
