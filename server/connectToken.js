const { createHmac, createHash, randomBytes, randomUUID } = require('crypto');
const { pool } = require('./db');
const { logAccessEvent } = require('./securityLog');
const { incrementMetric } = require('./securityMetrics');

const connectTokenSecret = process.env.CONNECT_TOKEN_SECRET || randomBytes(32).toString('hex');
const tokenTtlMs = Number(process.env.CONNECT_TOKEN_TTL_MS || 60_000);
const tokenSweepMs = Number(process.env.CONNECT_TOKEN_SWEEP_MS || 30_000);
const tokenStore = new Map();

function nowIso() {
  return new Date().toISOString();
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function encodeSegment(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeSegment(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function sign(payloadSegment) {
  return createHmac('sha256', connectTokenSecret).update(payloadSegment).digest('base64url');
}

function normalizeScope(scope = {}) {
  return {
    userId: scope.userId || null,
    hostId: scope.hostId || null,
    identityId: scope.identityId || null,
    credentialId: scope.credentialId || null,
    runtime: scope.runtime === 'electron' ? 'electron' : 'browser',
    purpose: scope.purpose || 'ssh',
    authType: scope.authType || null,
  };
}

function scopeMatches(expected, actual) {
  const normalizedExpected = normalizeScope(expected);
  const normalizedActual = normalizeScope(actual);
  return Object.entries(normalizedExpected).every(([key, value]) => {
    if (value === null || value === undefined) return true;
    return normalizedActual[key] === value;
  });
}

function cleanupExpiredTokens() {
  const now = Date.now();
  for (const [tokenId, entry] of tokenStore.entries()) {
    if (entry.expiresAt <= now) {
      tokenStore.delete(tokenId);
    }
  }
}

setInterval(cleanupExpiredTokens, tokenSweepMs).unref?.();

async function loadHost(userId, hostId) {
  if (!hostId) {
    throw Object.assign(new Error('Host is required'), { status: 400 });
  }

  const [rows] = await pool.execute(
    `SELECT id, user_id AS userId, name, host, port, username, auth_type AS authType, credential_id AS credentialId
       FROM hosts
      WHERE id = ?
      LIMIT 1`,
    [hostId]
  );
  const host = rows[0];
  if (!host) {
    throw Object.assign(new Error('Host not found'), { status: 404 });
  }
  if (host.userId !== userId) {
    throw Object.assign(new Error('Host does not belong to user'), { status: 403 });
  }
  return host;
}

async function loadIdentity(userId, credentialId) {
  if (!credentialId) return null;

  const [rows] = await pool.execute(
    `SELECT id, user_id AS userId
       FROM ssh_credentials
      WHERE id = ?
      LIMIT 1`,
    [credentialId]
  );
  const identity = rows[0];
  if (!identity) {
    throw Object.assign(new Error('Identity not found'), { status: 404 });
  }
  if (identity.userId !== userId) {
    throw Object.assign(new Error('Identity does not belong to user'), { status: 403 });
  }
  return identity;
}

function issueConnectToken(scope) {
  cleanupExpiredTokens();
  const normalizedScope = normalizeScope(scope);
  const tokenId = randomUUID();
  const issuedAt = Date.now();
  const expiresAt = issuedAt + tokenTtlMs;
  const payload = {
    id: tokenId,
    iat: issuedAt,
    exp: expiresAt,
    scope: normalizedScope,
  };
  const payloadSegment = encodeSegment(payload);
  const token = `${payloadSegment}.${sign(payloadSegment)}`;
  tokenStore.set(tokenId, {
    tokenHash: hashToken(token),
    scope: normalizedScope,
    issuedAt,
    expiresAt,
    consumedAt: null,
  });
  incrementMetric('tokenIssued', 1);
  logAccessEvent('tokenIssued', {
    userId: normalizedScope.userId,
    hostId: normalizedScope.hostId,
    runtime: normalizedScope.runtime,
    authType: normalizedScope.authType,
    purpose: normalizedScope.purpose,
    tokenIssued: true,
  });
  return {
    token,
    tokenId,
    expiresAt: new Date(expiresAt).toISOString(),
    scope: normalizedScope,
  };
}

function readToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) {
    throw Object.assign(new Error('Invalid connect authorization'), { status: 400 });
  }
  const [payloadSegment, signature] = token.split('.', 2);
  if (!payloadSegment || !signature) {
    throw Object.assign(new Error('Invalid connect authorization'), { status: 400 });
  }
  const expectedSignature = sign(payloadSegment);
  if (signature.length !== expectedSignature.length) {
    throw Object.assign(new Error('Invalid connect authorization'), { status: 400 });
  }
  if (!Buffer.from(signature).equals(Buffer.from(expectedSignature))) {
    throw Object.assign(new Error('Invalid connect authorization'), { status: 400 });
  }

  const payload = decodeSegment(payloadSegment);
  if (!payload?.id || !payload?.scope || !payload?.exp) {
    throw Object.assign(new Error('Invalid connect authorization'), { status: 400 });
  }
  return payload;
}

function rejectToken(reason, details = {}) {
  incrementMetric('tokenRejected', 1);
  logAccessEvent('tokenRejected', {
    ...details,
    reason,
    tokenRejected: true,
  });
}

function consumeConnectToken(token, expectedScope = {}) {
  cleanupExpiredTokens();
  let payload;
  const expected = normalizeScope(expectedScope);
  try {
    payload = readToken(token);
  } catch (error) {
    rejectToken('invalid', expected);
    throw error;
  }
  const entry = tokenStore.get(payload.id);

  if (!entry || entry.tokenHash !== hashToken(token)) {
    incrementMetric('reusedToken', 1);
    rejectToken('reused_or_unknown', expected);
    throw Object.assign(new Error('Connect authorization is no longer valid'), { status: 403 });
  }

  if (entry.expiresAt <= Date.now() || payload.exp <= Date.now()) {
    tokenStore.delete(payload.id);
    incrementMetric('expiredToken', 1);
    rejectToken('expired', expected);
    throw Object.assign(new Error('Connect authorization expired'), { status: 403 });
  }

  if (!scopeMatches(entry.scope, expected)) {
    tokenStore.delete(payload.id);
    incrementMetric('unauthorizedConnect', 1);
    rejectToken('scope_mismatch', {
      ...expected,
      tokenScope: entry.scope,
    });
    throw Object.assign(new Error('Connect authorization scope mismatch'), { status: 403 });
  }

  tokenStore.delete(payload.id);
  entry.consumedAt = Date.now();
  incrementMetric('tokenValidated', 1);
  logAccessEvent('tokenValidated', {
    userId: entry.scope.userId,
    hostId: entry.scope.hostId,
    runtime: entry.scope.runtime,
    authType: entry.scope.authType,
    purpose: entry.scope.purpose,
    tokenValidated: true,
  });
  return {
    tokenId: payload.id,
    scope: entry.scope,
    expiresAt: new Date(entry.expiresAt).toISOString(),
  };
}

async function issueAuthorizedConnectToken(userId, body = {}) {
  const host = await loadHost(userId, body.hostId);
  const identityId = body.credentialId || host.credentialId || null;
  const identity = identityId ? await loadIdentity(userId, identityId) : null;
  return issueConnectToken({
    userId,
    hostId: host.id,
    identityId: identity?.id || null,
    credentialId: identity?.id || null,
    runtime: body.runtime === 'electron' ? 'electron' : 'browser',
    purpose: body.purpose || 'ssh',
    authType: body.authType || host.authType || null,
  });
}

function invalidateConnectTokens(filter = {}) {
  const removed = [];
  for (const [tokenId, entry] of tokenStore.entries()) {
    if (scopeMatches(filter, entry.scope)) {
      tokenStore.delete(tokenId);
      removed.push(tokenId);
    }
  }
  if (removed.length > 0) {
    logAccessEvent('tokenInvalidated', {
      ...normalizeScope(filter),
      reason: filter.reason || 'scope_change',
      tokenInvalidated: true,
      count: removed.length,
    });
  }
  return removed.length;
}

function invalidateConnectTokensByUser(userId, reason = 'logout') {
  return invalidateConnectTokens({ userId, reason });
}

function invalidateConnectTokensByHost(userId, hostId, reason = 'host_deleted') {
  return invalidateConnectTokens({ userId, hostId, reason });
}

function invalidateConnectTokensByIdentity(userId, identityId, reason = 'identity_deleted') {
  return invalidateConnectTokens({ userId, identityId, credentialId: identityId, reason });
}

async function consumeTokenFromRequest(userId, body = {}) {
  const host = await loadHost(userId, body.hostId);
  const normalizedRuntime = body.runtime === 'electron' ? 'electron' : 'browser';
  return consumeConnectToken(body.connectToken, {
    userId,
    hostId: host.id,
    identityId: body.credentialId || host.credentialId || null,
    credentialId: body.credentialId || host.credentialId || null,
    runtime: normalizedRuntime,
    purpose: body.purpose || 'ssh',
    authType: body.authType || host.authType || null,
  });
}

module.exports = {
  consumeConnectToken,
  consumeTokenFromRequest,
  cleanupExpiredTokens,
  issueAuthorizedConnectToken,
  issueConnectToken,
  invalidateConnectTokens,
  invalidateConnectTokensByHost,
  invalidateConnectTokensByIdentity,
  invalidateConnectTokensByUser,
  loadHost,
  loadIdentity,
  normalizeScope,
  scopeMatches,
};
