const { createHmac, createHash, randomBytes, randomUUID } = require('crypto');
const { logAccessEvent } = require('./securityLog');

/**
 * Resume tokens authorize re-attaching a browser WebSocket to a relay session
 * that was detached by a transport drop. They are deliberately separate from
 * connect tokens: a connect token authorizes creating a new SSH session through
 * the full identity/credential flow, a resume token only authorizes taking over
 * an existing, already authenticated shell that belongs to the same user.
 *
 * Properties:
 * - scoped to userId + sessionId
 * - HMAC signed, stored by id with a hash of the token
 * - one-time: consumed on the first successful resume; a new one is issued
 *   for the next drop
 * - at most one valid token per session: issuing a new one invalidates the old
 * - lifetime equals the detach grace period
 */
const resumeTokenSecret =
  process.env.SESSION_SECRET ||
  process.env.APP_SECRET ||
  process.env.CONNECT_TOKEN_SECRET ||
  randomBytes(32).toString('hex');

const tokenStore = new Map();

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
  return createHmac('sha256', resumeTokenSecret).update(payloadSegment).digest('base64url');
}

function cleanupExpiredResumeTokens(now = Date.now()) {
  for (const [tokenId, entry] of tokenStore.entries()) {
    if (entry.expiresAt <= now) tokenStore.delete(tokenId);
  }
}

function invalidateResumeTokens({ sessionId = null, userId = null } = {}, reason = 'invalidated') {
  let removed = 0;
  for (const [tokenId, entry] of tokenStore.entries()) {
    if (sessionId !== null && entry.scope.sessionId !== sessionId) continue;
    if (userId !== null && entry.scope.userId !== userId) continue;
    tokenStore.delete(tokenId);
    removed += 1;
  }
  if (removed > 0) {
    logAccessEvent('resumeTokenInvalidated', { sessionId, userId, reason, count: removed });
  }
  return removed;
}

function issueResumeToken({ userId, sessionId, ttlMs }) {
  if (userId === undefined || userId === null || !sessionId) {
    throw Object.assign(new Error('Resume token scope is required'), { status: 400 });
  }
  cleanupExpiredResumeTokens();
  // Only one resume token may be valid per session at a time.
  invalidateResumeTokens({ sessionId }, 'reissued');

  const tokenId = randomUUID();
  const issuedAt = Date.now();
  const expiresAt = issuedAt + Math.max(1000, Number(ttlMs) || 0);
  const scope = { userId, sessionId };
  const payloadSegment = encodeSegment({ id: tokenId, iat: issuedAt, exp: expiresAt, scope });
  const token = `${payloadSegment}.${sign(payloadSegment)}`;
  tokenStore.set(tokenId, { tokenHash: hashToken(token), scope, issuedAt, expiresAt });
  logAccessEvent('resumeTokenIssued', { userId, sessionId, ttlMs: expiresAt - issuedAt });
  return { token, tokenId, expiresAt: new Date(expiresAt).toISOString(), ttlMs: expiresAt - issuedAt };
}

function readToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) {
    throw Object.assign(new Error('Invalid resume authorization'), { status: 400 });
  }
  const [payloadSegment, signature] = token.split('.', 2);
  if (!payloadSegment || !signature) {
    throw Object.assign(new Error('Invalid resume authorization'), { status: 400 });
  }
  const expected = sign(payloadSegment);
  if (signature.length !== expected.length || !Buffer.from(signature).equals(Buffer.from(expected))) {
    throw Object.assign(new Error('Invalid resume authorization'), { status: 400 });
  }
  const payload = decodeSegment(payloadSegment);
  if (!payload?.id || !payload?.scope || !payload?.exp) {
    throw Object.assign(new Error('Invalid resume authorization'), { status: 400 });
  }
  return payload;
}

function reject(reason, details) {
  logAccessEvent('resumeTokenRejected', { ...details, reason });
}

function consumeResumeToken(token, expectedScope = {}) {
  cleanupExpiredResumeTokens();
  let payload;
  try {
    payload = readToken(token);
  } catch (error) {
    reject('invalid', expectedScope);
    throw error;
  }

  const entry = tokenStore.get(payload.id);
  if (!entry || entry.tokenHash !== hashToken(token)) {
    reject('reused_or_unknown', expectedScope);
    throw Object.assign(new Error('Resume authorization is no longer valid'), { status: 403 });
  }
  if (entry.expiresAt <= Date.now() || payload.exp <= Date.now()) {
    tokenStore.delete(payload.id);
    reject('expired', expectedScope);
    throw Object.assign(new Error('Resume authorization expired'), { status: 403 });
  }
  if (entry.scope.userId !== expectedScope.userId || entry.scope.sessionId !== expectedScope.sessionId) {
    tokenStore.delete(payload.id);
    reject('scope_mismatch', expectedScope);
    throw Object.assign(new Error('Resume authorization scope mismatch'), { status: 403 });
  }

  tokenStore.delete(payload.id);
  logAccessEvent('resumeTokenValidated', { userId: entry.scope.userId, sessionId: entry.scope.sessionId });
  return { tokenId: payload.id, scope: entry.scope };
}

module.exports = {
  cleanupExpiredResumeTokens,
  consumeResumeToken,
  invalidateResumeTokens,
  issueResumeToken,
};
