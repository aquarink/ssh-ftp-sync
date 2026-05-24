const { randomUUID } = require('crypto');
const { clearSecretMaterial, cloneSecretMaterial } = require('./secretLifecycle');

const DEFAULT_EPHEMERAL_CREDENTIAL_TTL_MS = Number(process.env.EPHEMERAL_CREDENTIAL_TTL_MS || 30000);

function createEphemeralCredential({
  id = randomUUID(),
  sessionId = randomUUID(),
  hostId = null,
  userId,
  runtime,
  purpose,
  authType,
  material,
  ttlMs = DEFAULT_EPHEMERAL_CREDENTIAL_TTL_MS,
} = {}) {
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ttlMs);
  const state = {
    id,
    sessionId,
    hostId,
    userId,
    runtime,
    purpose,
    authType,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    material: cloneSecretMaterial(material),
    cleared: false,
  };

  state.clear = () => {
    if (state.cleared) return true;
    const cleared = clearSecretMaterial(state.material);
    state.material = null;
    state.cleared = true;
    return cleared;
  };

  return state;
}

function isEphemeralCredentialExpired(credential, now = Date.now()) {
  if (!credential || credential.cleared) return true;
  return Date.parse(credential.expiresAt) <= now;
}

module.exports = {
  DEFAULT_EPHEMERAL_CREDENTIAL_TTL_MS,
  createEphemeralCredential,
  isEphemeralCredentialExpired,
};
