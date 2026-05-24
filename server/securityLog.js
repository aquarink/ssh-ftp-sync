const { redactSecretFields } = require('./secretRedaction');

function logIdentityEvent(event, details) {
  const payload = redactSecretFields({
    event,
    timestamp: new Date().toISOString(),
    ...details,
  });
  console.info(`[identity] ${event}`, payload);
}

function logVaultEvent(event, details) {
  const payload = redactSecretFields({
    event,
    timestamp: new Date().toISOString(),
    ...details,
  });
  console.info(`[vault] ${event}`, payload);
}

function logAccessEvent(event, details) {
  const payload = redactSecretFields({
    event,
    timestamp: new Date().toISOString(),
    ...details,
  });
  console.info(`[access] ${event}`, payload);
}

module.exports = {
  logAccessEvent,
  logIdentityEvent,
  logVaultEvent,
  redactSecretFields,
};
