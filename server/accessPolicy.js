const { loadHost, loadIdentity, issueAuthorizedConnectToken, consumeConnectToken } = require('./connectToken');
const { logAccessEvent } = require('./securityLog');
const { incrementMetric } = require('./securityMetrics');
const { normalizeAuthType, normalizeRuntime, validateRuntimePolicy } = require('./runtimePolicy');

const rateWindowMs = Number(process.env.CONNECT_RATE_WINDOW_MS || 60_000);
const issueLimitPerUser = Number(process.env.CONNECT_ISSUE_LIMIT_PER_USER || 12);
const issueLimitPerHost = Number(process.env.CONNECT_ISSUE_LIMIT_PER_HOST || 8);
const connectLimitPerUser = Number(process.env.CONNECT_ATTEMPT_LIMIT_PER_USER || 20);
const connectLimitPerHost = Number(process.env.CONNECT_ATTEMPT_LIMIT_PER_HOST || 12);
const rateStore = new Map();
const allowedPurposes = new Set(['ssh', 'sftp', 'test_connection']);
const allowedRuntimes = new Set(['browser', 'electron']);

function rateKey(kind, scope) {
  return `${kind}:${scope}`;
}

function checkRateLimit(kind, scope, limit) {
  const key = rateKey(kind, scope);
  const now = Date.now();
  const entries = (rateStore.get(key) || []).filter((timestamp) => now - timestamp < rateWindowMs);
  entries.push(now);
  rateStore.set(key, entries);
  if (entries.length > limit) {
    const error = Object.assign(new Error('Too many connect attempts'), { status: 429 });
    error.reason = 'rate_limited';
    throw error;
  }
}

function rejectAccess(reason, details = {}) {
  incrementMetric(reason === 'runtime_policy_denied' ? 'runtimePolicyDenied' : 'unauthorizedConnect', 1);
  logAccessEvent('tokenRejected', {
    ...details,
    reason,
    tokenRejected: true,
  });
}

function invalidRequest(message = 'Invalid connect token request') {
  return Object.assign(new Error(message), { status: 400 });
}

function validateConnectTokenRequest(body = {}) {
  const hostId = typeof body.hostId === 'string' ? body.hostId.trim() : '';
  if (!hostId) {
    throw invalidRequest();
  }

  const runtime = normalizeRuntime(body.runtime);
  if (!allowedRuntimes.has(String(body.runtime || '').trim().toLowerCase())) {
    throw invalidRequest();
  }

  const purpose = typeof body.purpose === 'string' && body.purpose.trim() ? body.purpose.trim() : 'ssh';
  if (!allowedPurposes.has(purpose)) {
    throw invalidRequest();
  }

  const rawAuthType = body.authType;
  const authType = rawAuthType == null || rawAuthType === ''
    ? null
    : normalizeAuthType(rawAuthType);
  if (rawAuthType != null && rawAuthType !== '' && !authType) {
    throw invalidRequest();
  }

  const credentialId = body.credentialId == null || body.credentialId === ''
    ? null
    : String(body.credentialId).trim();

  return {
    hostId,
    runtime,
    purpose,
    authType,
    credentialId,
  };
}

async function issueConnectAuthorization(userId, body = {}) {
  const request = validateConnectTokenRequest(body);
  const host = await loadHost(userId, request.hostId);
  const authType = request.authType || normalizeAuthType(host.authType || null);
  const credentialId = request.credentialId || host.credentialId || null;

  checkRateLimit('issue-user', userId, issueLimitPerUser);
  checkRateLimit('issue-host', `${userId}:${host.id}`, issueLimitPerHost);

  const runtimePolicy = validateRuntimePolicy({ runtime: request.runtime, authType, purpose: request.purpose });
  if (!runtimePolicy.ok) {
    rejectAccess('runtime_policy_denied', {
      userId,
      hostId: host.id,
      runtime: request.runtime,
      authType,
      purpose: request.purpose,
    });
    throw Object.assign(new Error('Runtime policy denied connect authorization'), { status: 403 });
  }

  if (credentialId) {
    await loadIdentity(userId, credentialId);
  }

  return issueAuthorizedConnectToken(userId, {
    hostId: host.id,
    credentialId,
    runtime: request.runtime,
    purpose: request.purpose,
    authType,
  });
}

async function authorizeConnectRequest(userId, body = {}) {
  const request = validateConnectTokenRequest(body);
  const runtime = request.runtime;
  const purpose = request.purpose;
  const hostId = request.hostId;
  const authType = request.authType;
  const credentialId = request.credentialId;
  const connectToken = body.connectToken || body.token || null;

  if (!connectToken) {
    rejectAccess('missing_token', {
      userId,
      hostId: hostId || null,
      runtime,
      authType,
      purpose,
    });
    throw Object.assign(new Error('Connect authorization required'), { status: 401 });
  }

  checkRateLimit('connect-user', userId, connectLimitPerUser);
  if (hostId) {
    checkRateLimit('connect-host', `${userId}:${hostId}`, connectLimitPerHost);
  }

  const runtimePolicy = validateRuntimePolicy({ runtime, authType, purpose });
  if (!runtimePolicy.ok) {
    rejectAccess('runtime_policy_denied', {
      userId,
      hostId: hostId || null,
      runtime,
      authType,
      purpose,
    });
    throw Object.assign(new Error('Runtime policy denied connect request'), { status: 403 });
  }

  const consumed = consumeConnectToken(connectToken, {
    userId,
    hostId: hostId || null,
    identityId: credentialId || null,
    credentialId: credentialId || null,
    runtime,
    purpose,
    authType,
  });

  const host = await loadHost(userId, hostId);
  const hostAuthType = normalizeAuthType(host.authType || null);
  const selectedCredentialId = credentialId || host.credentialId || null;
  if (selectedCredentialId) {
    await loadIdentity(userId, selectedCredentialId);
  }

  if (hostAuthType && authType && hostAuthType !== authType) {
    rejectAccess('scope_mismatch', {
      userId,
      hostId: host.id,
      runtime,
      authType,
      purpose,
    });
    throw Object.assign(new Error('Connect authorization auth type mismatch'), { status: 403 });
  }

  return {
    host,
    credentialId: selectedCredentialId,
    authType: authType || hostAuthType || null,
    runtime,
    purpose,
    connectTokenId: consumed.tokenId,
    scope: consumed.scope,
  };
}

function invalidateConnectAuthorizationsByUser(userId, reason = 'logout') {
  const { invalidateConnectTokensByUser } = require('./connectToken');
  return invalidateConnectTokensByUser(userId, reason);
}

function invalidateConnectAuthorizationsByHost(userId, hostId, reason = 'host_deleted') {
  const { invalidateConnectTokensByHost } = require('./connectToken');
  return invalidateConnectTokensByHost(userId, hostId, reason);
}

function invalidateConnectAuthorizationsByIdentity(userId, identityId, reason = 'identity_deleted') {
  const { invalidateConnectTokensByIdentity } = require('./connectToken');
  return invalidateConnectTokensByIdentity(userId, identityId, reason);
}

module.exports = {
  authorizeConnectRequest,
  checkRateLimit,
  issueConnectAuthorization,
  invalidateConnectAuthorizationsByHost,
  invalidateConnectAuthorizationsByIdentity,
  invalidateConnectAuthorizationsByUser,
  validateConnectTokenRequest,
};
