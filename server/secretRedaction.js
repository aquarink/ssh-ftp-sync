const sensitiveKeyPattern = /^(password|privateKey|passphrase|certificate|certificatePrivateKey|token|refreshToken|accessToken|vaultKey|credentialSecret|secret|keyMaterial|agent)$/i;

function redactSecretFields(value, parentSensitive = false) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') {
    return parentSensitive ? '[REDACTED]' : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecretFields(item, parentSensitive));
  }

  const redacted = {};
  for (const [key, entry] of Object.entries(value)) {
    const isSensitive = parentSensitive || sensitiveKeyPattern.test(key);
    redacted[key] = isSensitive ? '[REDACTED]' : redactSecretFields(entry, false);
  }
  return redacted;
}

module.exports = {
  redactSecretFields,
  sensitiveKeyPattern,
};
