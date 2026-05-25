function validateRegisterLegalConsent(body = {}) {
  if (!body.agreeLegal) {
    throw Object.assign(new Error('You must agree to the Terms & Conditions and Privacy Policy'), { status: 400 });
  }

  if (body.legalVersion !== '2026-05') {
    throw Object.assign(new Error('Invalid legal agreement version'), { status: 400 });
  }
}

module.exports = {
  validateRegisterLegalConsent,
};
