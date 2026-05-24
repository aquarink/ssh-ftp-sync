const { redactSecretFields } = require('./secretRedaction');

function logIdentityEvent(event, details) {
  const payload = redactSecretFields({ event, ...details });
  console.info(`[identity] ${event}`, payload);
}

function logVaultEvent(event, details) {
  const payload = redactSecretFields({ event, ...details });
  console.info(`[vault] ${event}`, payload);
}

module.exports = {
  logIdentityEvent,
  logVaultEvent,
  redactSecretFields,
};
