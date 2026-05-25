const { createEphemeralCredential, isEphemeralCredentialExpired } = require('../ephemeralCredential');

describe('ephemeralCredential - resolve-then-connect lifecycle', () => {
  describe('credential availability and clearing sequence', () => {
    it('should have available material immediately after creation', () => {
      const material = {
        password: 'secret123',
        privateKey: Buffer.from('key-data'),
      };
      const credential = createEphemeralCredential({
        userId: 'user1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material,
      });

      expect(credential.material).toBeDefined();
      expect(credential.material).not.toBeNull();
      expect(credential.material.password).toBe('secret123');
      expect(Buffer.isBuffer(credential.material.privateKey)).toBe(true);
    });

    it('should maintain material availability during credential resolve phase', () => {
      const material = {
        password: 'ssh-secret',
        username: 'testuser',
      };
      const credential = createEphemeralCredential({
        userId: 'user1',
        hostId: 'host1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material,
      });

      // Simulate resolve phase: material should be available for connection
      expect(credential.material).toBeDefined();
      expect(credential.cleared).toBe(false);
      expect(isEphemeralCredentialExpired(credential)).toBe(false);
    });

    it('should allow material extraction for SSH connection', () => {
      const privateKeyContent = '-----BEGIN PRIVATE KEY-----\nkey-data\n-----END PRIVATE KEY-----';
      const privateKey = Buffer.from(privateKeyContent);
      const passphrase = 'key-passphrase';
      
      const material = {
        privateKey,
        passphrase,
      };

      const credential = createEphemeralCredential({
        userId: 'user1',
        hostId: 'host1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'private_key_passphrase',
        material,
      });

      // Simulate buildConnectConfig (extract material for ssh2)
      const connectConfig = {
        privateKey: credential.material.privateKey,
        passphrase: credential.material.passphrase,
      };

      // Material is cloned, so check content equality not reference equality
      expect(Buffer.isBuffer(connectConfig.privateKey)).toBe(true);
      expect(connectConfig.privateKey.toString()).toBe(privateKeyContent);
      expect(connectConfig.passphrase).toBe(passphrase);
    });

    it('should clear material after SSH connection attempt', () => {
      const credential = createEphemeralCredential({
        userId: 'user1',
        hostId: 'host1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: {
          password: 'ssh-secret',
        },
      });

      // Simulate: used material for connection
      expect(credential.material.password).toBe('ssh-secret');

      // Simulate: finally block clears material after connection
      const cleared = credential.clear();

      expect(cleared).toBe(true);
      expect(credential.cleared).toBe(true);
      expect(credential.material).toBeNull();
    });

    it('should prevent access to cleared material', () => {
      const credential = createEphemeralCredential({
        userId: 'user1',
        hostId: 'host1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: {
          password: 'secret123',
        },
      });

      credential.clear();

      // Attempting to access material after clear
      expect(credential.material).toBeNull();
      expect(() => {
        // Would throw if anyone tried to access material properties
        if (!credential.cleared) {
          return credential.material.password;
        }
        throw new Error('Credential is cleared');
      }).toThrow('Credential is cleared');
    });

    it('should idempotently handle multiple clear calls', () => {
      const credential = createEphemeralCredential({
        userId: 'user1',
        hostId: 'host1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: {
          password: 'secret',
        },
      });

      const firstClear = credential.clear();
      const secondClear = credential.clear();
      const thirdClear = credential.clear();

      expect(firstClear).toBe(true);
      expect(secondClear).toBe(true);
      expect(thirdClear).toBe(true);
      expect(credential.material).toBeNull();
      expect(credential.cleared).toBe(true);
    });

    it('should mark credential as expired after clearing', () => {
      const credential = createEphemeralCredential({
        userId: 'user1',
        hostId: 'host1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: {
          password: 'secret',
        },
        ttlMs: 60000, // Still has TTL
      });

      expect(isEphemeralCredentialExpired(credential)).toBe(false);

      credential.clear();

      // After clear, should be considered expired
      expect(isEphemeralCredentialExpired(credential)).toBe(true);
    });
  });

  describe('lifecycle timing constraints', () => {
    it('should respect expiration before clear call', () => {
      const credential = createEphemeralCredential({
        userId: 'user1',
        hostId: 'host1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: { password: 'secret' },
        ttlMs: 1000, // 1 second
      });

      // Simulate: material is available
      expect(credential.material).not.toBeNull();

      // Wait for expiration
      const futureTime = Date.now() + 2000;
      expect(isEphemeralCredentialExpired(credential, futureTime)).toBe(true);

      // Material should still be there until we check and clear
      expect(credential.material).not.toBeNull();

      // Caller should check expiration before using material
      if (isEphemeralCredentialExpired(credential, futureTime)) {
        credential.clear();
      }

      expect(credential.material).toBeNull();
    });

    it('should maintain material availability during connection setup', () => {
      const credential = createEphemeralCredential({
        userId: 'user1',
        hostId: 'host1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: {
          username: 'user',
          password: 'pass',
        },
        ttlMs: 5000,
      });

      const startTime = Date.now();
      const connectionSetupTime = 100; // 100ms to setup

      // Simulate: during connection setup, material should be available
      expect(credential.material).not.toBeNull();

      // Simulate: time passes during connection
      const simulatedElapsedTime = startTime + connectionSetupTime;

      // Material should still be valid
      expect(isEphemeralCredentialExpired(credential, simulatedElapsedTime)).toBe(false);
      expect(credential.material).not.toBeNull();
    });

    it('should prevent using expired credential for connection', () => {
      const credential = createEphemeralCredential({
        userId: 'user1',
        hostId: 'host1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: { password: 'secret' },
        ttlMs: 1000,
      });

      const expirationTime = Date.parse(credential.expiresAt) + 1;

      // Check if expired
      if (isEphemeralCredentialExpired(credential, expirationTime)) {
        credential.clear();
        // Caller should not use material
        expect(credential.material).toBeNull();
      }
    });
  });

  describe('credential lifecycle in error scenarios', () => {
    it('should clear credential on connection error', () => {
      const credential = createEphemeralCredential({
        userId: 'user1',
        hostId: 'host1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: { password: 'secret' },
      });

      try {
        // Simulate: connection error
        throw new Error('Connection failed');
      } catch (error) {
        // Finally block: clear material
        credential.clear();
      }

      expect(credential.material).toBeNull();
      expect(credential.cleared).toBe(true);
    });

    it('should clear credential on authentication failure', () => {
      const credential = createEphemeralCredential({
        userId: 'user1',
        hostId: 'host1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: { password: 'wrong-secret' },
      });

      // Simulate: authentication fails
      const authFailed = true;
      if (authFailed) {
        credential.clear();
      }

      expect(credential.cleared).toBe(true);
      expect(credential.material).toBeNull();
    });

    it('should handle credential clear during async connection', async () => {
      const credential = createEphemeralCredential({
        userId: 'user1',
        hostId: 'host1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: { password: 'secret' },
      });

      try {
        // Simulate async connection
        await new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error('Connection timeout')), 50);
        });
      } catch (error) {
        credential.clear();
      }

      expect(credential.cleared).toBe(true);
      expect(credential.material).toBeNull();
    });

    it('should clear credential even if material is already corrupted', () => {
      const credential = createEphemeralCredential({
        userId: 'user1',
        hostId: 'host1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: {
          password: Buffer.from('secret'),
        },
      });

      // Simulate: material partially corrupted
      credential.material.password.fill(0);

      // Clear should still succeed
      const result = credential.clear();

      expect(result).toBe(true);
      expect(credential.cleared).toBe(true);
      expect(credential.material).toBeNull();
    });
  });

  describe('multi-credential scenarios', () => {
    it('should manage multiple credentials independently', () => {
      const credential1 = createEphemeralCredential({
        userId: 'user1',
        hostId: 'host1',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: { password: 'secret1' },
      });

      const credential2 = createEphemeralCredential({
        userId: 'user1',
        hostId: 'host2',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        material: { password: 'secret2' },
      });

      expect(credential1.material.password).toBe('secret1');
      expect(credential2.material.password).toBe('secret2');

      credential1.clear();

      expect(credential1.material).toBeNull();
      expect(credential2.material).not.toBeNull();

      credential2.clear();

      expect(credential2.material).toBeNull();
    });

    it('should preserve credentials until individually cleared', () => {
      const credentials = Array.from({ length: 3 }, (_, i) => 
        createEphemeralCredential({
          userId: 'user1',
          hostId: `host${i}`,
          runtime: 'browser',
          purpose: 'ssh',
          authType: 'password',
          material: { password: `secret${i}` },
        })
      );

      // Clear middle credential
      credentials[1].clear();

      expect(credentials[0].material).not.toBeNull();
      expect(credentials[1].material).toBeNull();
      expect(credentials[2].material).not.toBeNull();
    });
  });
});
