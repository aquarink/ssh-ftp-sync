const { pool } = require('./db');
const { readCredentialSecret } = require('./credentialStore');
const { logIdentityEvent } = require('./securityLog');
const { clearSecretMaterial } = require('./secretLifecycle');
const { createEphemeralCredential } = require('./ephemeralCredential');

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
  throw Object.assign(new Error('Authentication method is not supported yet'), { status: 400 });
}

function browserRuntimeUnsupported() {
  throw Object.assign(new Error('Authentication method is not supported in browser runtime'), { status: 400 });
}

function credentialSecretUnavailable() {
  throw Object.assign(new Error('Credential secret is unavailable'), { status: 400 });
}

function hostNotFound() {
  throw Object.assign(new Error('Host not found'), { status: 404 });
}

function identityNotFound() {
  throw Object.assign(new Error('Identity not found'), { status: 404 });
}

function identityNotOwned() {
  throw Object.assign(new Error('Identity does not belong to user'), { status: 403 });
}

function normalizeRuntime(runtime) {
  return runtime === 'electron' ? 'electron' : 'browser';
}

function normalizeAuthType(authType) {
  if (!authType) return null;
  const value = String(authType).trim();
  return supportedAuthTypes.has(value) ? value : null;
}

function normalizeHostAuthType(authType) {
  const value = normalizeAuthType(authType);
  if (!value) return null;
  if (value === 'credential') return 'identity';
  return value;
}

async function loadHost(userId, hostId) {
  if (!hostId) return null;
  const [rows] = await pool.execute(
    `SELECT id, user_id, name, host, port, username, auth_type, credential_id, startup_directory, notes, tags
       FROM hosts
      WHERE id = ?
      LIMIT 1`,
    [hostId]
  );
  const host = rows[0];
  if (!host || host.user_id !== userId) hostNotFound();
  return host;
}

async function loadCredential(userId, credentialId) {
  if (!credentialId) return null;
  const [rows] = await pool.execute(
    `SELECT id, user_id, type, label, username, fingerprint, public_key_fingerprint, certificate_fingerprint, notes, storage_ref
       FROM ssh_credentials
      WHERE id = ?
      LIMIT 1`,
    [credentialId]
  );
  const credential = rows[0];
  if (!credential) identityNotFound();
  if (credential.user_id !== userId) identityNotOwned();
  return credential;
}

function resolveSecretMaterial(credential, secret, runtime) {
  const type = credential.type;
  if (type === 'password') {
    if (typeof secret.password !== 'string' || !secret.password) credentialSecretUnavailable();
    return { password: secret.password };
  }

  if (type === 'private_key' || type === 'private_key_passphrase' || type === 'key_pair') {
    if (typeof secret.privateKey !== 'string' || !secret.privateKey) credentialSecretUnavailable();
    return {
      privateKey: secret.privateKey,
      passphrase: typeof secret.passphrase === 'string' && secret.passphrase ? secret.passphrase : undefined,
    };
  }

  if (type === 'key_with_certificate') {
    if (typeof secret.privateKey !== 'string' || !secret.privateKey || typeof secret.certificate !== 'string' || !secret.certificate) {
      credentialSecretUnavailable();
    }
    return {
      privateKey: secret.privateKey,
      passphrase: typeof secret.passphrase === 'string' && secret.passphrase ? secret.passphrase : undefined,
      cert: secret.certificate,
    };
  }

  if (type === 'certificate') {
    if (typeof secret.certificate !== 'string' || !secret.certificate) credentialSecretUnavailable();
    return { cert: secret.certificate };
  }

  if (type === 'agent') {
    if (runtime === 'browser') browserRuntimeUnsupported();
    if (typeof secret.agent !== 'string' || !secret.agent) credentialSecretUnavailable();
    return { agent: secret.agent };
  }

  if (type === 'one_time') unsupportedYet();

  unsupportedYet();
}

async function resolveIdentity({
  userId,
  hostId = null,
  runtime = 'browser',
  authType = null,
  credentialId = null,
  purpose = 'ssh',
  sessionId = null,
}) {
  const normalizedRuntime = normalizeRuntime(runtime);
  const host = await loadHost(userId, hostId);
  const normalizedAuthType = normalizeHostAuthType(authType || host?.auth_type || null);
  const selectedCredentialId = credentialId || host?.credential_id || null;
  if (normalizedRuntime !== 'browser' && normalizedRuntime !== 'electron') {
    throw Object.assign(new Error('Authentication method is not supported yet'), { status: 400 });
  }

  if (host && host.credential_id && credentialId && host.credential_id !== credentialId) {
    throw Object.assign(new Error('Identity is not assigned to this host'), { status: 403 });
  }

  if (host && host.auth_type && normalizedAuthType && normalizeHostAuthType(host.auth_type) !== normalizedAuthType) {
    if (!(normalizeHostAuthType(host.auth_type) === 'identity' && normalizedAuthType === 'password' && !host.credential_id)) {
      throw Object.assign(new Error('Identity is not assigned to this host'), { status: 403 });
    }
  }

  if (!selectedCredentialId) {
    if (normalizedAuthType === 'password') {
      logIdentityEvent('resolve-missing-credential', {
        userId,
        hostId: host?.id || null,
        credentialId: null,
        authType: normalizedAuthType,
        runtime: normalizedRuntime,
        purpose,
        result: 'error',
        reason: 'Credential is required',
      });
      credentialSecretUnavailable();
    }
    throw Object.assign(new Error('Identity is not assigned to this host'), { status: 403 });
  }

  const credential = await loadCredential(userId, selectedCredentialId);
  let secret = null;
  let material = null;
  try {
    secret = readCredentialSecret(credential.storage_ref);
    material = resolveSecretMaterial(credential, secret, normalizedRuntime);
    const ephemeralCredential = createEphemeralCredential({
      sessionId,
      hostId: host?.id || null,
      userId,
      runtime: normalizedRuntime,
      purpose,
      authType: normalizedAuthType || credential.type,
      material,
    });

    logIdentityEvent('credentialResolved', {
      userId,
      hostId: host?.id || null,
      credentialId: credential.id,
      sessionId: ephemeralCredential.sessionId,
      authType: normalizedAuthType || credential.type,
      runtime: normalizedRuntime,
      purpose,
      result: 'ok',
      timestamp: new Date().toISOString(),
    });

    return {
      host,
      credential: {
        id: credential.id,
        type: credential.type,
        label: credential.label,
        username: credential.username,
        fingerprint: credential.fingerprint,
        publicKeyFingerprint: credential.public_key_fingerprint,
        certificateFingerprint: credential.certificate_fingerprint,
        notes: credential.notes,
      },
      authType: normalizedAuthType || credential.type,
      runtime: normalizedRuntime,
      purpose,
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

module.exports = {
  resolveIdentity,
  browserRuntimeUnsupported,
  credentialSecretUnavailable,
  identityNotFound,
  identityNotOwned,
  unsupportedYet,
};
