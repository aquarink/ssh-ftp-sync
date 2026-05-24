function redactSecretValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value ? '[redacted]' : value;
  if (Array.isArray(value)) return value.map(redactSecretValue);
  if (typeof value !== 'object') return value;

  const redacted = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/(password|passphrase|privateKey|private_key|certificate|token|secret|agent)/i.test(key)) {
      redacted[key] = '[redacted]';
    } else {
      redacted[key] = redactSecretValue(entry);
    }
  }
  return redacted;
}

function logIdentityEvent(event, details) {
  const payload = redactSecretValue({
    event,
    ...details,
  });
  console.info(`[identity] ${event}`, payload);
}

module.exports = {
  logIdentityEvent,
  redactSecretValue,
};
