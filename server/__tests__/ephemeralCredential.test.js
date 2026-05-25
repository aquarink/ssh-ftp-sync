const {
  createEphemeralCredential,
  isEphemeralCredentialExpired,
  DEFAULT_EPHEMERAL_CREDENTIAL_TTL_MS,
} = require('../ephemeralCredential');
const { clearSecretMaterial, cloneSecretMaterial } = require('../secretLifecycle');

describe('ephemeralCredential', () => {
  describe('createEphemeralCredential', () => {
    it('should create a credential with required fields', () => {
      const material = { password: 'secret123' };
      const credential = createEphemeralCredential({
        userId: 'user1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material,
      });

      expect(credential.id).toBeDefined();
      expect(credential.sessionId).toBeDefined();
      expect(credential.userId).toBe('user1');
      expect(credential.runtime).toBe('browser');
      expect(credential.purpose).toBe('ssh');
      expect(credential.authType).toBe('password');
      expect(credential.cleared).toBe(false);
      expect(credential.material).toBeDefined();
      expect(credential.createdAt).toBeDefined();
      expect(credential.expiresAt).toBeDefined();
    });

    it('should clone material to prevent direct reference', () => {
      const original = { password: 'secret123' };
      const credential = createEphemeralCredential({
        userId: 'user1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: original,
      });

      expect(credential.material).not.toBe(original);
      expect(credential.material.password).toBe(original.password);
    });

    it('should set expiration time correctly', () => {
      const ttlMs = 10000;
      const beforeCreate = Date.now();
      const credential = createEphemeralCredential({
        userId: 'user1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: { password: 'secret' },
        ttlMs,
      });
      const afterCreate = Date.now();

      const expiresAt = Date.parse(credential.expiresAt);
      expect(expiresAt).toBeGreaterThanOrEqual(beforeCreate + ttlMs);
      expect(expiresAt).toBeLessThanOrEqual(afterCreate + ttlMs);
    });

    it('should use default TTL when not specified', () => {
      const credential = createEphemeralCredential({
        userId: 'user1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: { password: 'secret' },
      });

      const expiresAt = Date.parse(credential.expiresAt);
      const createdAt = Date.parse(credential.createdAt);
      const ttl = expiresAt - createdAt;

      expect(ttl).toBe(DEFAULT_EPHEMERAL_CREDENTIAL_TTL_MS);
    });

    it('should have a clear function that clears material', () => {
      const credential = createEphemeralCredential({
        userId: 'user1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: { password: Buffer.from('secret'), token: 'abc' },
      });

      expect(typeof credential.clear).toBe('function');
      expect(credential.cleared).toBe(false);

      const result = credential.clear();

      expect(result).toBe(true);
      expect(credential.cleared).toBe(true);
      expect(credential.material).toBeNull();
    });

    it('should allow custom id and sessionId', () => {
      const customId = 'custom-id-123';
      const customSessionId = 'session-456';
      const credential = createEphemeralCredential({
        id: customId,
        sessionId: customSessionId,
        userId: 'user1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: { password: 'secret' },
      });

      expect(credential.id).toBe(customId);
      expect(credential.sessionId).toBe(customSessionId);
    });

    it('should allow hostId to be null or set', () => {
      const credential1 = createEphemeralCredential({
        userId: 'user1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: { password: 'secret' },
      });
      expect(credential1.hostId).toBeNull();

      const credential2 = createEphemeralCredential({
        hostId: 'host-123',
        userId: 'user1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: { password: 'secret' },
      });
      expect(credential2.hostId).toBe('host-123');
    });
  });

  describe('ephemeralCredential.clear()', () => {
    it('should return true on successful clear', () => {
      const credential = createEphemeralCredential({
        userId: 'user1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: { password: 'secret' },
      });

      const result = credential.clear();

      expect(result).toBe(true);
    });

    it('should prevent double-clearing', () => {
      const credential = createEphemeralCredential({
        userId: 'user1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: { password: 'secret' },
      });

      const firstClear = credential.clear();
      const secondClear = credential.clear();

      expect(firstClear).toBe(true);
      expect(secondClear).toBe(true); // Returns true but doesn't clear again
      expect(credential.material).toBeNull();
    });

    it('should clear nested objects with sensitive keys', () => {
      const credential = createEphemeralCredential({
        userId: 'user1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: {
          password: 'secret123',
          nested: {
            privateKey: Buffer.from('key-data'),
            passphrase: 'phrase123',
          },
          token: 'abc123',
        },
      });

      credential.clear();

      expect(credential.material).toBeNull();
      expect(credential.cleared).toBe(true);
    });

    it('should handle material with buffers', () => {
      const passwordBuffer = Buffer.from('secret123');
      const keyBuffer = Buffer.from('private-key-data');

      const credential = createEphemeralCredential({
        userId: 'user1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: {
          password: passwordBuffer,
          privateKey: keyBuffer,
        },
      });

      const result = credential.clear();

      expect(result).toBe(true);
      expect(credential.cleared).toBe(true);
      expect(credential.material).toBeNull();
    });

    it('should set cleared flag to true', () => {
      const credential = createEphemeralCredential({
        userId: 'user1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: { password: 'secret' },
      });

      expect(credential.cleared).toBe(false);
      credential.clear();
      expect(credential.cleared).toBe(true);
    });
  });

  describe('isEphemeralCredentialExpired', () => {
    it('should return false for non-expired credential', () => {
      const credential = createEphemeralCredential({
        userId: 'user1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: { password: 'secret' },
        ttlMs: 60000, // 60 seconds
      });

      const isExpired = isEphemeralCredentialExpired(credential, Date.now());

      expect(isExpired).toBe(false);
    });

    it('should return true for expired credential', () => {
      const credential = createEphemeralCredential({
        userId: 'user1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: { password: 'secret' },
        ttlMs: 1000, // 1 second
      });

      const futureTime = Date.now() + 2000; // 2 seconds later
      const isExpired = isEphemeralCredentialExpired(credential, futureTime);

      expect(isExpired).toBe(true);
    });

    it('should return true for null credential', () => {
      const isExpired = isEphemeralCredentialExpired(null);

      expect(isExpired).toBe(true);
    });

    it('should return true for undefined credential', () => {
      const isExpired = isEphemeralCredentialExpired(undefined);

      expect(isExpired).toBe(true);
    });

    it('should return true for cleared credential', () => {
      const credential = createEphemeralCredential({
        userId: 'user1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: { password: 'secret' },
        ttlMs: 60000, // Still valid time-wise
      });

      credential.clear();
      const isExpired = isEphemeralCredentialExpired(credential);

      expect(isExpired).toBe(true);
    });

    it('should use current time when not provided', () => {
      const credential = createEphemeralCredential({
        userId: 'user1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: { password: 'secret' },
        ttlMs: 60000, // 60 seconds
      });

      const isExpired = isEphemeralCredentialExpired(credential); // No time argument

      expect(isExpired).toBe(false);
    });

    it('should handle expiration boundary correctly', () => {
      const ttlMs = 10000;
      const credential = createEphemeralCredential({
        userId: 'user1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: { password: 'secret' },
        ttlMs,
      });

      const expiresAt = Date.parse(credential.expiresAt);

      // Just before expiration
      const beforeExpiration = isEphemeralCredentialExpired(credential, expiresAt - 1);
      expect(beforeExpiration).toBe(false);

      // At expiration
      const atExpiration = isEphemeralCredentialExpired(credential, expiresAt);
      expect(atExpiration).toBe(true);

      // After expiration
      const afterExpiration = isEphemeralCredentialExpired(credential, expiresAt + 1);
      expect(afterExpiration).toBe(true);
    });
  });
});
