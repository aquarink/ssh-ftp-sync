const { readCredentialSecret } = require('./credentialVault');

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
    if (typeof secret.agent !== 'string' || !secret.agent) credentialUnavailable();
    return { agent: secret.agent };
  }
  if (type === 'one_time') unsupportedYet();
  unsupportedYet();
}

function resolveIdentity({
  userId,
  hostId = null,
  hostUserId = null,
  runtime = 'electron',
  authType = null,
  credentialId = null,
  purpose = 'ssh',
}) {
  const normalizedRuntime = normalizeRuntime(runtime);
  const normalizedAuthType = normalizeAuthType(authType);
  if (normalizedRuntime === 'browser') browserUnsupported();
  if (hostId && hostUserId && hostUserId !== userId) {
    throw new Error('Host does not belong to user');
  }
  if (!credentialId) {
    if (normalizedAuthType === 'password') credentialUnavailable();
    throw new Error('Identity is not assigned to this host');
  }
  if (hostUserId && hostUserId !== userId) {
    throw new Error('Host not found');
  }

  const secret = readCredentialSecret(userId, credentialId);
  const connection = resolveSecretMaterial(secret, normalizedRuntime);

  return {
    hostId,
    authType: normalizedAuthType,
    runtime: normalizedRuntime,
    purpose,
    connection,
  };
}

module.exports = { resolveIdentity };
