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
  'manual',
]);

function normalizeRuntime(runtime) {
  return String(runtime || '').toLowerCase() === 'electron' ? 'electron' : 'browser';
}

function normalizeAuthType(authType) {
  if (!authType) return null;
  const value = String(authType).trim().toLowerCase();
  if (!supportedAuthTypes.has(value)) return null;
  return value === 'credential' ? 'identity' : value;
}

function getRuntimePolicy(runtime) {
  const normalized = normalizeRuntime(runtime);
  if (normalized === 'electron') {
    return {
      runtime: normalized,
      allowLocalAgent: true,
      allowLocalFilesystemIdentity: true,
      allowRelayOnly: false,
      allowedAuthTypes: new Set(['password', 'private_key', 'private_key_passphrase', 'key_with_certificate', 'certificate', 'agent', 'identity', 'manual']),
    };
  }

  return {
    runtime: 'browser',
    allowLocalAgent: false,
    allowLocalFilesystemIdentity: false,
    allowRelayOnly: true,
    allowedAuthTypes: new Set(['password', 'private_key', 'private_key_passphrase', 'key_with_certificate', 'certificate', 'identity', 'manual']),
  };
}

function validateRuntimePolicy({ runtime, authType, purpose }) {
  const policy = getRuntimePolicy(runtime);
  const normalizedAuthType = normalizeAuthType(authType);
  if (normalizedAuthType === 'one_time') {
    return { ok: false, policy, reason: 'one_time_auth_disabled' };
  }

  if (normalizedAuthType && !policy.allowedAuthTypes.has(normalizedAuthType)) {
    return { ok: false, policy, reason: 'auth_type_not_allowed' };
  }

  if (policy.runtime === 'browser' && normalizedAuthType === 'agent') {
    return { ok: false, policy, reason: 'browser_agent_not_allowed' };
  }

  if (purpose && !['ssh', 'sftp', 'test_connection'].includes(String(purpose))) {
    return { ok: false, policy, reason: 'purpose_not_allowed' };
  }

  return { ok: true, policy, reason: null };
}

module.exports = {
  getRuntimePolicy,
  normalizeAuthType,
  normalizeRuntime,
  validateRuntimePolicy,
};
