const { readCredentialSecret } = require('./credentialVault');
const { clearSecretMaterial } = require('./secretLifecycle');
const { createEphemeralCredential } = require('./ephemeralCredential');
const { logIdentityEvent } = require('./securityLog');

const supportedAuthTypes = new Set([
  'password',
  'private_key',
  'private_key_passphrase',
  'key_with_certificate',
  'certificate',
  'agent',
  'one_time',
  'identity',
  'credential',
]);

function unsupportedYet() {
  throw new Error('Authentication method is not supported yet');
}

function browserUnsupported() {
  throw new Error('Authentication method is not supported in browser runtime');
}

function credentialUnavailable() {
  throw new Error('Credential secret is unavailable');
}

function normalizeRuntime(runtime) {
  return runtime === 'browser' ? 'browser' : 'electron';
}

function normalizeAuthType(authType) {
  if (!authType) return null;
  const value = String(authType).trim();
  return supportedAuthTypes.has(value) ? value : null;
}

function resolveSecretMaterial(secret, runtime) {
  const type = secret.type;
  if (type === 'password') {
    if (typeof secret.password !== 'string' || !secret.password) credentialUnavailable();
    return { password: secret.password };
  }
  if (type === 'private_key' || type === 'private_key_passphrase' || type === 'key_pair') {
    if (typeof secret.privateKey !== 'string' || !secret.privateKey) credentialUnavailable();
    return {
      privateKey: secret.privateKey,
      passphrase: typeof secret.passphrase === 'string' && secret.passphrase ? secret.passphrase : undefined,
    };
  }
  if (type === 'key_with_certificate') {
    if (typeof secret.privateKey !== 'string' || !secret.privateKey || typeof secret.certificate !== 'string' || !secret.certificate) {
      credentialUnavailable();
    }
    return {
      privateKey: secret.privateKey,
      passphrase: typeof secret.passphrase === 'string' && secret.passphrase ? secret.passphrase : undefined,
      cert: secret.certificate,
    };
  }
  if (type === 'certificate') {
    if (typeof secret.certificate !== 'string' || !secret.certificate) credentialUnavailable();
    return { cert: secret.certificate };
  }
  if (type === 'agent') {
    if (runtime === 'browser') browserUnsupported();
    if (process.env.ENABLE_OS_SSH_AGENT !== 'true') {
      throw new Error('OS ssh-agent integration is disabled by default. Enable it via ENABLE_OS_SSH_AGENT=true.');
    }
    if (typeof secret.agent !== 'string' || !secret.agent) credentialUnavailable();
    return { agent: secret.agent };
  }
  if (type === 'one_time') unsupportedYet();
  unsupportedYet();
}

function resolveIdentity({
  userId,
  authenticatedUserId = null,
  hostId = null,
  hostUserId = null,
  runtime = 'electron',
  authType = null,
  credentialId = null,
  purpose = 'ssh',
  sessionId = null,
}) {
  const normalizedRuntime = normalizeRuntime(runtime);
  const normalizedAuthType = normalizeAuthType(authType);
  if (normalizedRuntime === 'browser') browserUnsupported();
  const effectiveUserId = authenticatedUserId || userId;
  if (!effectiveUserId) {
    throw new Error('Authenticated user context is unavailable');
  }
  if (authenticatedUserId && userId && authenticatedUserId !== userId) {
    throw new Error('Renderer user context does not match authenticated session context');
  }
  if (hostId && hostUserId && hostUserId !== effectiveUserId) {
    throw new Error('Host does not belong to user');
  }
  if (!credentialId) {
    if (normalizedAuthType === 'password') credentialUnavailable();
    throw new Error('Identity is not assigned to this host');
  }
  if (hostUserId && hostUserId !== effectiveUserId) {
    throw new Error('Host not found');
  }

  let secret = null;
  let material = null;
  try {
    secret = readCredentialSecret(effectiveUserId, credentialId);
    material = resolveSecretMaterial(secret, normalizedRuntime);
    const ephemeralCredential = createEphemeralCredential({
      sessionId,
      hostId,
      userId: effectiveUserId,
      runtime: normalizedRuntime,
      purpose,
      authType: normalizedAuthType || secret.type || null,
      material,
    });
    logIdentityEvent('credentialResolved', {
      userId: effectiveUserId,
      hostId,
      credentialId: credentialId || ephemeralCredential.id,
      sessionId: ephemeralCredential.sessionId,
      authType: normalizedAuthType || secret.type || null,
      runtime: normalizedRuntime,
      purpose,
      result: 'ok',
      timestamp: new Date().toISOString(),
    });

    return {
      hostId,
      authType: normalizedAuthType || secret.type || null,
      runtime: normalizedRuntime,
      purpose,
      userId: effectiveUserId,
      ephemeralCredential,
    };
  } finally {
    if (secret) {
      clearSecretMaterial(secret);
    }
    if (material) {
      clearSecretMaterial(material);
    }
  }
}

module.exports = { resolveIdentity };
