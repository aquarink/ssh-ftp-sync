const { redactSecretFields } = require('./secretRedaction');

function logIdentityEvent(event, details) {
  const payload = redactSecretFields({ event, timestamp: new Date().toISOString(), ...details });
  console.info(`[identity] ${event}`, payload);
}

function logVaultEvent(event, details) {
  const payload = redactSecretFields({ event, timestamp: new Date().toISOString(), ...details });
  console.info(`[vault] ${event}`, payload);
}

module.exports = {
  logIdentityEvent,
  logVaultEvent,
  redactSecretFields,
};
