const {
  resolveIdentity,
  browserRuntimeUnsupported,
  credentialSecretUnavailable,
  identityNotFound,
  identityNotOwned,
  unsupportedYet,
} = require('../identityResolver');

jest.mock('../db', () => ({
  pool: {
    execute: jest.fn(),
  },
}));

jest.mock('../credentialStore', () => ({
  readCredentialSecret: jest.fn(),
}));

jest.mock('../securityLog', () => ({
  logIdentityEvent: jest.fn(),
}));

const { pool } = require('../db');
const { readCredentialSecret } = require('../credentialStore');
const { logIdentityEvent } = require('../securityLog');

describe('server/identityResolver - Security & Behavior Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Utility/Error Exports', () => {
    test('browserRuntimeUnsupported throws 400 error', () => {
      expect(() => browserRuntimeUnsupported()).toThrow('Authentication method is not supported in browser runtime');
      try {
        browserRuntimeUnsupported();
      } catch (err) {
        expect(err.status).toBe(400);
      }
    });

    test('credentialSecretUnavailable throws 400 error', () => {
      expect(() => credentialSecretUnavailable()).toThrow('Credential secret is unavailable');
      try {
        credentialSecretUnavailable();
      } catch (err) {
        expect(err.status).toBe(400);
      }
    });

    test('identityNotFound throws 404 error', () => {
      expect(() => identityNotFound()).toThrow('Identity not found');
      try {
        identityNotFound();
      } catch (err) {
        expect(err.status).toBe(404);
      }
    });

    test('identityNotOwned throws 403 error', () => {
      expect(() => identityNotOwned()).toThrow('Identity does not belong to user');
      try {
        identityNotOwned();
      } catch (err) {
        expect(err.status).toBe(403);
      }
    });

    test('unsupportedYet throws 400 error', () => {
      expect(() => unsupportedYet()).toThrow('Authentication method is not supported yet');
      try {
        unsupportedYet();
      } catch (err) {
        expect(err.status).toBe(400);
      }
    });
  });

  describe('Host Loading & Validation', () => {
    test('throws 404 Host Not Found if host does not exist', async () => {
      pool.execute.mockResolvedValueOnce([[]]); // No host rows

      await expect(
        resolveIdentity({
          userId: 1,
          hostId: 100,
          runtime: 'browser',
        })
      ).rejects.toThrow('Host not found');
    });

    test('throws 404 Host Not Found if host belongs to another user', async () => {
      pool.execute.mockResolvedValueOnce([[{ id: 100, user_id: 2 }]]); // Belongs to user 2

      await expect(
        resolveIdentity({
          userId: 1, // Logged in as user 1
          hostId: 100,
          runtime: 'browser',
        })
      ).rejects.toThrow('Host not found');
    });
  });

  describe('Credential/Identity Loading & Validation', () => {
    test('throws 404 Identity Not Found if requested credential does not exist', async () => {
      // Mock host lookup
      pool.execute.mockResolvedValueOnce([[{ id: 100, user_id: 1, auth_type: 'identity', credential_id: 50 }]]);
      // Mock credential lookup
      pool.execute.mockResolvedValueOnce([[]]); // No credential rows

      await expect(
        resolveIdentity({
          userId: 1,
          hostId: 100,
          runtime: 'browser',
        })
      ).rejects.toThrow('Identity not found');
    });

    test('throws 403 Identity Not Owned if credential belongs to another user', async () => {
      // Mock host lookup
      pool.execute.mockResolvedValueOnce([[{ id: 100, user_id: 1, auth_type: 'identity', credential_id: 50 }]]);
      // Mock credential lookup (belongs to user 2)
      pool.execute.mockResolvedValueOnce([[{ id: 50, user_id: 2 }]]);

      await expect(
        resolveIdentity({
          userId: 1,
          hostId: 100,
          runtime: 'browser',
        })
      ).rejects.toThrow('Identity does not belong to user');
    });
  });

  describe('Scoped Selection and Enforcement', () => {
    test('throws 403 if requested credential does not match host assigned credential', async () => {
      // Host has credential 50 assigned
      pool.execute.mockResolvedValueOnce([[{ id: 100, user_id: 1, credential_id: 50 }]]);

      await expect(
        resolveIdentity({
          userId: 1,
          hostId: 100,
          credentialId: 60, // Requesting credential 60
          runtime: 'browser',
        })
      ).rejects.toThrow('Identity is not assigned to this host');
    });

    test('throws 403 if requested auth type does not match host auth type preference', async () => {
      // Host prefers identity
      pool.execute.mockResolvedValueOnce([[{ id: 100, user_id: 1, auth_type: 'identity', credential_id: 50 }]]);

      await expect(
        resolveIdentity({
          userId: 1,
          hostId: 100,
          authType: 'password', // Requesting password
          credentialId: 50,
          runtime: 'browser',
        })
      ).rejects.toThrow('Identity is not assigned to this host');
    });

    test('throws 403 if no credential assigned and host does not support password fallback', async () => {
      // Host prefers identity but has no credential assigned
      pool.execute.mockResolvedValueOnce([[{ id: 100, user_id: 1, auth_type: 'identity', credential_id: null }]]);

      await expect(
        resolveIdentity({
          userId: 1,
          hostId: 100,
          runtime: 'browser',
        })
      ).rejects.toThrow('Identity is not assigned to this host');
    });
  });

  describe('No Assigned Credential Behavior', () => {
    test('throws 400 if requested authType is password but no credential is assigned', async () => {
      const mockHost = {
        id: 100,
        user_id: 1,
        auth_type: 'password',
        credential_id: null,
      };
      pool.execute.mockResolvedValueOnce([[mockHost]]);

      await expect(
        resolveIdentity({
          userId: 1,
          hostId: 100,
          authType: 'password',
          runtime: 'browser',
        })
      ).rejects.toThrow('Credential secret is unavailable');

      expect(logIdentityEvent).toHaveBeenCalledWith('resolve-missing-credential', expect.any(Object));
    });
  });

  describe('Secret Material Resolution', () => {
    const mockHost = { id: 100, user_id: 1, auth_type: 'identity', credential_id: 50 };
    const mockCredBase = { id: 50, user_id: 1, storage_ref: 'ref-123' };

    test('resolves password identity correctly', async () => {
      pool.execute.mockResolvedValueOnce([[mockHost]]);
      pool.execute.mockResolvedValueOnce([[{ ...mockCredBase, type: 'password', label: 'My Pass' }]]);
      readCredentialSecret.mockReturnValueOnce({ password: 'secret-vault-password' });

      const result = await resolveIdentity({
        userId: 1,
        hostId: 100,
        runtime: 'browser',
      });

      expect(result.authType).toBe('identity');
      expect(result.ephemeralCredential.material).toEqual({ password: 'secret-vault-password' });
      expect(result.credential.label).toBe('My Pass');
      expect(logIdentityEvent).toHaveBeenCalledWith('credentialResolved', expect.any(Object));
    });

    test('resolves private key identity correctly', async () => {
      pool.execute.mockResolvedValueOnce([[mockHost]]);
      pool.execute.mockResolvedValueOnce([[{ ...mockCredBase, type: 'private_key' }]]);
      readCredentialSecret.mockReturnValueOnce({
        privateKey: '-----BEGIN RSA PRIVATE KEY-----',
        passphrase: 'key-passphrase',
      });

      const result = await resolveIdentity({
        userId: 1,
        hostId: 100,
        runtime: 'browser',
      });

      expect(result.ephemeralCredential.material).toEqual({
        privateKey: '-----BEGIN RSA PRIVATE KEY-----',
        passphrase: 'key-passphrase',
      });
    });

    test('resolves key with certificate identity correctly', async () => {
      pool.execute.mockResolvedValueOnce([[mockHost]]);
      pool.execute.mockResolvedValueOnce([[{ ...mockCredBase, type: 'key_with_certificate' }]]);
      readCredentialSecret.mockReturnValueOnce({
        privateKey: '-----BEGIN RSA PRIVATE KEY-----',
        certificate: 'ssh-rsa-cert-v01@openssh.com...',
        passphrase: 'pass',
      });

      const result = await resolveIdentity({
        userId: 1,
        hostId: 100,
        runtime: 'browser',
      });

      expect(result.ephemeralCredential.material).toEqual({
        privateKey: '-----BEGIN RSA PRIVATE KEY-----',
        cert: 'ssh-rsa-cert-v01@openssh.com...',
        passphrase: 'pass',
      });
    });

    test('resolves certificate-only identity correctly', async () => {
      pool.execute.mockResolvedValueOnce([[mockHost]]);
      pool.execute.mockResolvedValueOnce([[{ ...mockCredBase, type: 'certificate' }]]);
      readCredentialSecret.mockReturnValueOnce({
        certificate: 'ssh-rsa-cert-v01@openssh.com...',
      });

      const result = await resolveIdentity({
        userId: 1,
        hostId: 100,
        runtime: 'browser',
      });

      expect(result.ephemeralCredential.material).toEqual({
        cert: 'ssh-rsa-cert-v01@openssh.com...',
      });
    });

    test('resolves agent identity correctly in electron runtime', async () => {
      pool.execute.mockResolvedValueOnce([[mockHost]]);
      pool.execute.mockResolvedValueOnce([[{ ...mockCredBase, type: 'agent' }]]);
      readCredentialSecret.mockReturnValueOnce({
        agent: '/var/run/ssh-agent.sock',
      });

      const result = await resolveIdentity({
        userId: 1,
        hostId: 100,
        runtime: 'electron', // Electron mode
      });

      expect(result.ephemeralCredential.material).toEqual({
        agent: '/var/run/ssh-agent.sock',
      });
    });

    test('throws 400 when resolving agent identity in browser runtime', async () => {
      pool.execute.mockResolvedValueOnce([[mockHost]]);
      pool.execute.mockResolvedValueOnce([[{ ...mockCredBase, type: 'agent' }]]);
      readCredentialSecret.mockReturnValueOnce({
        agent: '/var/run/ssh-agent.sock',
      });

      await expect(
        resolveIdentity({
          userId: 1,
          hostId: 100,
          runtime: 'browser', // Browser mode
        })
      ).rejects.toThrow('Authentication method is not supported in browser runtime');
    });

    test('throws 400 when resolving one_time identity', async () => {
      pool.execute.mockResolvedValueOnce([[mockHost]]);
      pool.execute.mockResolvedValueOnce([[{ ...mockCredBase, type: 'one_time' }]]);

      await expect(
        resolveIdentity({
          userId: 1,
          hostId: 100,
          runtime: 'browser',
        })
      ).rejects.toThrow('Authentication method is not supported yet');
    });

    test('throws 400 when credential type is unrecognized', async () => {
      pool.execute.mockResolvedValueOnce([[mockHost]]);
      pool.execute.mockResolvedValueOnce([[{ ...mockCredBase, type: 'unrecognized_method' }]]);

      await expect(
        resolveIdentity({
          userId: 1,
          hostId: 100,
          runtime: 'browser',
        })
      ).rejects.toThrow('Authentication method is not supported yet');
    });

    test('throws 400 if secret material is missing privateKey/password/cert', async () => {
      pool.execute.mockResolvedValueOnce([[mockHost]]);
      pool.execute.mockResolvedValueOnce([[{ ...mockCredBase, type: 'password' }]]);
      readCredentialSecret.mockReturnValueOnce({}); // Empty secret (no password)

      await expect(
        resolveIdentity({
          userId: 1,
          hostId: 100,
          runtime: 'browser',
        })
      ).rejects.toThrow('Credential secret is unavailable');
    });
  });
});
