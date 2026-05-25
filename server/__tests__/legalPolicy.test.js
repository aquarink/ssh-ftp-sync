const { validateRegisterLegalConsent } = require('../legalPolicy');

describe('register legal consent validation', () => {
  test('register without agreeLegal returns 400', () => {
    expect(() => validateRegisterLegalConsent({ agreeLegal: false, legalVersion: '2026-05' })).toThrow(
      'You must agree to the Terms & Conditions and Privacy Policy'
    );
    try {
      validateRegisterLegalConsent({ agreeLegal: false, legalVersion: '2026-05' });
    } catch (error) {
      expect(error.status).toBe(400);
    }
  });

  test('register with wrong legalVersion returns 400', () => {
    expect(() => validateRegisterLegalConsent({ agreeLegal: true, legalVersion: '2025-01' })).toThrow(
      'Invalid legal agreement version'
    );
    try {
      validateRegisterLegalConsent({ agreeLegal: true, legalVersion: '2025-01' });
    } catch (error) {
      expect(error.status).toBe(400);
    }
  });

  test('register with agreeLegal=true and legalVersion=2026-05 succeeds', () => {
    expect(() => validateRegisterLegalConsent({ agreeLegal: true, legalVersion: '2026-05' })).not.toThrow();
  });
});
