const metrics = {
  tokenIssued: 0,
  tokenValidated: 0,
  tokenRejected: 0,
  expiredToken: 0,
  reusedToken: 0,
  runtimePolicyDenied: 0,
  unauthorizedConnect: 0,
};

function incrementMetric(name, amount = 1) {
  if (!Object.prototype.hasOwnProperty.call(metrics, name)) return;
  metrics[name] += amount;
}

function getSecurityMetrics(sessionMetrics = {}) {
  return {
    ...metrics,
    activeAuthorizedSessions: Number(sessionMetrics.activeSessions || 0),
  };
}

module.exports = {
  getSecurityMetrics,
  incrementMetric,
  metrics,
};
