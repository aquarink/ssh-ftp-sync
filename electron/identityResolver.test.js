const { resolveIdentity } = require('./identityResolver');

jest.mock('./credentialVault');
jest.mock('./secretLifecycle');
jest.mock('./ephemeralCredential');
jest.mock('./securityLog');

const { readCredentialSecret } = require('./credentialVault');
const { createEphemeralCredential, clearSecretMaterial } = require('./ephemeralCredential');

describe('electron/identityResolver - Security & Behavior Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, ENABLE_OS_SSH_AGENT: 'true' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Metadata-Only Response Security', () => {
    test('top-level response does not expose raw secrets', () => {
      const userId = 'user123';
      const secretPassword = 'super-secret-password-12345';

      readCredentialSecret.mockReturnValue({
        type: 'password',
        password: secretPassword,
      });

      createEphemeralCredential.mockReturnValue({
        id: 'eph123',
        sessionId: 'sess123',
        hostId: null,
        userId,
        runtime: 'electron',
        purpose: 'ssh',
        authType: 'password',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30000).toISOString(),
        material: { password: secretPassword },
        cleared: false,
      });

      const result = resolveIdentity({
        userId,
        authenticatedUserId: userId,
        runtime: 'electron',
        credentialId: 'cred123',
      });

      // Top-level result should NOT expose password
      expect(result.password).toBeUndefined();
      expect(result.privateKey).toBeUndefined();
      
      // Secrets are encapsulated in ephemeralCredential.material
      expect(result.ephemeralCredential.material.password).toBe(secretPassword);
    });

    test('response has metadata properties only at top level', () => {
      readCredentialSecret.mockReturnValue({
        type: 'private_key',
        privateKey: '-----BEGIN PRIVATE KEY-----',
      });

      createEphemeralCredential.mockReturnValue({
        id: 'eph123',
        sessionId: 'sess123',
        hostId: 'host1',
        userId: 'user123',
        runtime: 'electron',
        purpose: 'ssh',
        authType: 'private_key',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30000).toISOString(),
        material: { privateKey: '-----BEGIN PRIVATE KEY-----' },
        cleared: false,
      });

      const result = resolveIdentity({
        userId: 'user123',
        authenticatedUserId: 'user123',
        hostId: 'host1',
        runtime: 'electron',
        credentialId: 'cred123',
      });

      // Top level has metadata only
      expect(result).toEqual({
        hostId: 'host1',
        authType: 'private_key',
        runtime: 'electron',
        purpose: 'ssh',
        userId: 'user123',
        ephemeralCredential: expect.objectContaining({
          material: expect.any(Object),
        }),
      });
    });
  });

  describe('Browser vs Electron Runtime Behavior', () => {
    test('browser runtime throws immediately without accessing vault', () => {
      const attempt = () => resolveIdentity({
        userId: 'user123',
        runtime: 'browser',
        credentialId: 'cred123',
      });

      expect(attempt).toThrow('not supported in browser runtime');
      expect(readCredentialSecret).not.toHaveBeenCalled();
    });

    test('electron runtime successfully resolves credentials', () => {
      readCredentialSecret.mockReturnValue({
        type: 'password',
        password: 'pass',
      });

      createEphemeralCredential.mockReturnValue({
        id: 'eph1',
        sessionId: 'sess1',
        hostId: null,
        userId: 'user123',
        runtime: 'electron',
        purpose: 'ssh',
        authType: 'password',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30000).toISOString(),
        material: { password: 'pass' },
        cleared: false,
      });

      const result = resolveIdentity({
        userId: 'user123',
        authenticatedUserId: 'user123',
        runtime: 'electron',
        credentialId: 'cred123',
      });

      expect(result.ephemeralCredential).toBeDefined();
      expect(result.runtime).toBe('electron');
    });

    test('electron runtime supports all credential types', () => {
      const types = [
        { type: 'password', secret: { type: 'password', password: 'p' } },
        { type: 'private_key', secret: { type: 'private_key', privateKey: 'k' } },
        { type: 'key_with_certificate', secret: { type: 'key_with_certificate', privateKey: 'k', certificate: 'c' } },
        { type: 'agent', secret: { type: 'agent', agent: '/tmp/agent' } },
      ];

      for (const { type, secret } of types) {
        jest.clearAllMocks();
        readCredentialSecret.mockReturnValue(secret);

        createEphemeralCredential.mockReturnValue({
          id: 'eph1',
          sessionId: 'sess1',
          hostId: null,
          userId: 'user123',
          runtime: 'electron',
          purpose: 'ssh',
          authType: type,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 30000).toISOString(),
          material: Object.assign({}, secret),
          cleared: false,
        });

        const result = resolveIdentity({
          userId: 'user123',
          authenticatedUserId: 'user123',
          runtime: 'electron',
          credentialId: 'cred123',
          authType: type,
        });

        expect(result.authType).toBe(type);
        expect(readCredentialSecret).toHaveBeenCalled();
      }
    });
  });

  describe('User Context Validation', () => {
    test('requires authenticated user context', () => {
      const attempt = () => resolveIdentity({
        userId: null,
        authenticatedUserId: null,
        runtime: 'electron',
        credentialId: 'cred123',
      });

      expect(attempt).toThrow('Authenticated user context is unavailable');
      expect(readCredentialSecret).not.toHaveBeenCalled();
    });

    test('validates user context consistency', () => {
      const attempt = () => resolveIdentity({
        userId: 'renderer-user',
        authenticatedUserId: 'authenticated-user',
        runtime: 'electron',
        credentialId: 'cred123',
      });

      expect(attempt).toThrow('does not match authenticated session context');
      expect(readCredentialSecret).not.toHaveBeenCalled();
    });

    test('uses authenticated user ID when present', () => {
      readCredentialSecret.mockReturnValue({
        type: 'password',
        password: 'pass',
      });

      createEphemeralCredential.mockReturnValue({
        id: 'eph1',
        sessionId: 'sess1',
        hostId: null,
        userId: 'auth-user',
        runtime: 'electron',
        purpose: 'ssh',
        authType: 'password',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30000).toISOString(),
        material: { password: 'pass' },
        cleared: false,
      });

      resolveIdentity({
        userId: null,
        authenticatedUserId: 'auth-user',
        runtime: 'electron',
        credentialId: 'cred123',
      });

      expect(readCredentialSecret).toHaveBeenCalledWith('auth-user', 'cred123');
    });

    test('falls back to renderer user ID when authenticated user is null', () => {
      readCredentialSecret.mockReturnValue({
        type: 'password',
        password: 'pass',
      });

      createEphemeralCredential.mockReturnValue({
        id: 'eph1',
        sessionId: 'sess1',
        hostId: null,
        userId: 'renderer-user',
        runtime: 'electron',
        purpose: 'ssh',
        authType: 'password',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30000).toISOString(),
        material: { password: 'pass' },
        cleared: false,
      });

      resolveIdentity({
        userId: 'renderer-user',
        authenticatedUserId: null,
        runtime: 'electron',
        credentialId: 'cred123',
      });

      expect(readCredentialSecret).toHaveBeenCalledWith('renderer-user', 'cred123');
    });
  });

  describe('Host Ownership Validation', () => {
    test('throws when host does not belong to user', () => {
      const attempt = () => resolveIdentity({
        userId: 'user123',
        hostId: 'host456',
        hostUserId: 'different-user',
        runtime: 'electron',
        credentialId: 'cred123',
      });

      expect(attempt).toThrow('Host does not belong to user');
      expect(readCredentialSecret).not.toHaveBeenCalled();
    });

    test('allows resolution when host belongs to user', () => {
      readCredentialSecret.mockReturnValue({
        type: 'password',
        password: 'pass',
      });

      createEphemeralCredential.mockReturnValue({
        id: 'eph1',
        sessionId: 'sess1',
        hostId: 'host456',
        userId: 'user123',
        runtime: 'electron',
        purpose: 'ssh',
        authType: 'password',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30000).toISOString(),
        material: { password: 'pass' },
        cleared: false,
      });

      const result = resolveIdentity({
        userId: 'user123',
        hostId: 'host456',
        hostUserId: 'user123',
        runtime: 'electron',
        credentialId: 'cred123',
      });

      expect(result.hostId).toBe('host456');
    });
  });

  describe('Credential Requirements', () => {
    test('throws when credential is missing and password auth specified', () => {
      const attempt = () => resolveIdentity({
        userId: 'user123',
        authenticatedUserId: 'user123',
        runtime: 'electron',
        authType: 'password',
        credentialId: null,
      });

      expect(attempt).toThrow('Credential secret is unavailable');
      expect(readCredentialSecret).not.toHaveBeenCalled();
    });

    test('throws when credential is missing and no auth type specified', () => {
      const attempt = () => resolveIdentity({
        userId: 'user123',
        authenticatedUserId: 'user123',
        runtime: 'electron',
        credentialId: null,
      });

      expect(attempt).toThrow('Identity is not assigned to this host');
      expect(readCredentialSecret).not.toHaveBeenCalled();
    });

    test('succeeds when valid credential provided', () => {
      readCredentialSecret.mockReturnValue({
        type: 'password',
        password: 'pass',
      });

      createEphemeralCredential.mockReturnValue({
        id: 'eph1',
        sessionId: 'sess1',
        hostId: null,
        userId: 'user123',
        runtime: 'electron',
        purpose: 'ssh',
        authType: 'password',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30000).toISOString(),
        material: { password: 'pass' },
        cleared: false,
      });

      const result = resolveIdentity({
        userId: 'user123',
        authenticatedUserId: 'user123',
        runtime: 'electron',
        credentialId: 'cred123',
      });

      expect(result.ephemeralCredential).toBeDefined();
    });
  });

  describe('Secret Material Handling', () => {
    test('wraps secrets in ephemeralCredential.material', () => {
      const privateKey = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpA...';

      readCredentialSecret.mockReturnValue({
        type: 'private_key',
        privateKey,
      });

      createEphemeralCredential.mockReturnValue({
        id: 'eph1',
        sessionId: 'sess1',
        hostId: null,
        userId: 'user123',
        runtime: 'electron',
        purpose: 'ssh',
        authType: 'private_key',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30000).toISOString(),
        material: { privateKey },
        cleared: false,
      });

      const result = resolveIdentity({
        userId: 'user123',
        authenticatedUserId: 'user123',
        runtime: 'electron',
        credentialId: 'cred123',
      });

      expect(result.ephemeralCredential.material.privateKey).toBe(privateKey);
      expect(result.privateKey).toBeUndefined();
    });

    test('handles passphrases with private keys', () => {
      const privateKey = '-----BEGIN RSA PRIVATE KEY-----';
      const passphrase = 'my-passphrase';

      readCredentialSecret.mockReturnValue({
        type: 'private_key',
        privateKey,
        passphrase,
      });

      createEphemeralCredential.mockReturnValue({
        id: 'eph1',
        sessionId: 'sess1',
        hostId: null,
        userId: 'user123',
        runtime: 'electron',
        purpose: 'ssh',
        authType: 'private_key',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30000).toISOString(),
        material: { privateKey, passphrase },
        cleared: false,
      });

      const result = resolveIdentity({
        userId: 'user123',
        authenticatedUserId: 'user123',
        runtime: 'electron',
        credentialId: 'cred123',
      });

      expect(result.ephemeralCredential.material).toEqual({
        privateKey,
        passphrase,
      });
    });

    test('handles key_with_certificate type', () => {
      const privateKey = '-----BEGIN RSA PRIVATE KEY-----';
      const certificate = '-----BEGIN CERTIFICATE-----';

      readCredentialSecret.mockReturnValue({
        type: 'key_with_certificate',
        privateKey,
        certificate,
      });

      createEphemeralCredential.mockReturnValue({
        id: 'eph1',
        sessionId: 'sess1',
        hostId: null,
        userId: 'user123',
        runtime: 'electron',
        purpose: 'ssh',
        authType: 'key_with_certificate',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30000).toISOString(),
        material: { privateKey, cert: certificate },
        cleared: false,
      });

      const result = resolveIdentity({
        userId: 'user123',
        authenticatedUserId: 'user123',
        runtime: 'electron',
        credentialId: 'cred123',
        authType: 'key_with_certificate',
      });

      expect(result.ephemeralCredential.material).toEqual({
        privateKey,
        cert: certificate,
      });
    });
  });

  describe('Error Handling', () => {
    test('throws when secret material is unavailable', () => {
      readCredentialSecret.mockReturnValue({
        type: 'password',
        password: null,
      });

      const attempt = () => resolveIdentity({
        userId: 'user123',
        authenticatedUserId: 'user123',
        runtime: 'electron',
        credentialId: 'cred123',
      });

      expect(attempt).toThrow('Credential secret is unavailable');
    });

    test('throws when certificate is missing for key_with_certificate', () => {
      readCredentialSecret.mockReturnValue({
        type: 'key_with_certificate',
        privateKey: 'key-data',
        certificate: null,
      });

      const attempt = () => resolveIdentity({
        userId: 'user123',
        authenticatedUserId: 'user123',
        runtime: 'electron',
        credentialId: 'cred123',
        authType: 'key_with_certificate',
      });

      expect(attempt).toThrow('Credential secret is unavailable');
    });

    test('cleans up secret material in finally block', () => {
      readCredentialSecret.mockReturnValue({
        type: 'password',
        password: 'pass',
      });

      createEphemeralCredential.mockReturnValue({
        id: 'eph1',
        sessionId: 'sess1',
        hostId: null,
        userId: 'user123',
        runtime: 'electron',
        purpose: 'ssh',
        authType: 'password',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30000).toISOString(),
        material: { password: 'pass' },
        cleared: false,
      });

      const { clearSecretMaterial } = require('./secretLifecycle');
      resolveIdentity({
        userId: 'user123',
        authenticatedUserId: 'user123',
        runtime: 'electron',
        credentialId: 'cred123',
      });

      // Verify cleanup was called (mocked)
      expect(clearSecretMaterial).toHaveBeenCalled();
    });
  });

  describe('Logging & Audit Trail', () => {
    test('logs successful credential resolution', () => {
      const { logIdentityEvent } = require('./securityLog');
      
      readCredentialSecret.mockReturnValue({
        type: 'password',
        password: 'pass',
      });

      createEphemeralCredential.mockReturnValue({
        id: 'eph1',
        sessionId: 'sess1',
        hostId: 'host1',
        userId: 'user123',
        runtime: 'electron',
        purpose: 'ssh',
        authType: 'password',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30000).toISOString(),
        material: { password: 'pass' },
        cleared: false,
      });

      resolveIdentity({
        userId: 'user123',
        authenticatedUserId: 'user123',
        hostId: 'host1',
        runtime: 'electron',
        credentialId: 'cred123',
      });

      expect(logIdentityEvent).toHaveBeenCalledWith(
        'credentialResolved',
        expect.objectContaining({
          userId: 'user123',
          hostId: 'host1',
          result: 'ok',
          runtime: 'electron',
        })
      );
    });
  });
});
