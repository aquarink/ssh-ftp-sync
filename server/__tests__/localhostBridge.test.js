const {
  authorizeConnectRequest,
  classifyTargetHost,
  isLoopbackAddress,
  isPrivateLanAddress,
  isPublicIpv4Address,
  isUnspecifiedAddress,
  validateApiBindHost,
} = require('../accessPolicy');
const { pool } = require('../db');
const { issueConnectToken } = require('../connectToken');
const { LocalBridgeSessionManager } = require('../localBridge');

jest.mock('../db', () => ({
  pool: {
    execute: jest.fn(),
  },
}));

jest.mock('../securityLog', () => ({
  logAccessEvent: jest.fn(),
}));

jest.mock('../securityMetrics', () => ({
  incrementMetric: jest.fn(),
}));

describe('Client Local Network Access Policy', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('isLoopbackAddress', () => {
    test('identifies loopback hostnames and IPs', () => {
      expect(isLoopbackAddress('localhost')).toBe(true);
      expect(isLoopbackAddress('127.0.0.1')).toBe(true);
      expect(isLoopbackAddress('127.31.2.99')).toBe(true);
      expect(isLoopbackAddress('::1')).toBe(true);
    });

    test('identifies non-loopback hostnames and IPs', () => {
      expect(isLoopbackAddress('0.0.0.0')).toBe(false);
      expect(isLoopbackAddress('::')).toBe(false);
      expect(isLoopbackAddress('example.com')).toBe(false);
      expect(isLoopbackAddress('192.168.1.1')).toBe(false);
      expect(isLoopbackAddress('8.8.8.8')).toBe(false);
      expect(isLoopbackAddress(null)).toBe(false);
      expect(isLoopbackAddress(undefined)).toBe(false);
    });

    test('identifies unspecified / wildcard addresses separately from loopback', () => {
      expect(isUnspecifiedAddress('0.0.0.0')).toBe(true);
      expect(isUnspecifiedAddress('::')).toBe(true);
      expect(isUnspecifiedAddress('[::]')).toBe(true);
      expect(isUnspecifiedAddress('127.0.0.1')).toBe(false);
      expect(isUnspecifiedAddress('::1')).toBe(false);
    });

    test('identifies private LAN and public IPv4 classes', () => {
      expect(isPrivateLanAddress('192.168.1.10')).toBe(true);
      expect(isPrivateLanAddress('10.0.2.15')).toBe(true);
      expect(isPrivateLanAddress('172.16.0.5')).toBe(true);
      expect(isPrivateLanAddress('172.31.255.1')).toBe(true);
      expect(isPrivateLanAddress('172.32.0.1')).toBe(false);
      expect(isPublicIpv4Address('8.8.8.8')).toBe(true);
      expect(isPublicIpv4Address('192.168.1.1')).toBe(false);
    });

    test('classifies target hosts for runtime policy decisions', () => {
      expect(classifyTargetHost('localhost')).toBe('LOOPBACK');
      expect(classifyTargetHost('127.10.20.30')).toBe('LOOPBACK');
      expect(classifyTargetHost('192.168.56.101')).toBe('PRIVATE_LAN');
      expect(classifyTargetHost('0.0.0.0')).toBe('WILDCARD_INVALID');
      expect(classifyTargetHost('8.8.8.8')).toBe('PUBLIC_REMOTE');
      expect(classifyTargetHost('example.com')).toBe('UNKNOWN_DOMAIN');
    });
  });

  describe('authorizeConnectRequest - Runtime local network constraints', () => {
    test('browser runtime rejects loopback targets', async () => {
      pool.execute.mockResolvedValueOnce([[{
        id: 'host-123',
        userId: 'user-123',
        name: 'Local Test',
        host: '127.0.0.1',
        port: 22,
        username: 'root',
        authType: 'password',
        credentialId: null,
      }]]);

      const { token } = issueConnectToken({
        userId: 'user-123',
        hostId: 'host-123',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
      });

      await expect(
        authorizeConnectRequest('user-123', {
          hostId: 'host-123',
          runtime: 'browser',
          purpose: 'ssh',
          authType: 'password',
          connectToken: token,
        })
      ).rejects.toThrow('This target is local to your device. Please use Electron Desktop or Local Bridge.');
    });

    test('browser runtime rejects private LAN targets', async () => {
      pool.execute.mockResolvedValueOnce([[{
        id: 'host-123',
        userId: 'user-123',
        name: 'Private LAN Test',
        host: '192.168.56.101',
        port: 22,
        username: 'root',
        authType: 'password',
        credentialId: null,
      }]]);

      const { token } = issueConnectToken({
        userId: 'user-123',
        hostId: 'host-123',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
      });

      await expect(
        authorizeConnectRequest('user-123', {
          hostId: 'host-123',
          runtime: 'browser',
          purpose: 'ssh',
          authType: 'password',
          connectToken: token,
        })
      ).rejects.toThrow('This target is local to your device. Please use Electron Desktop or Local Bridge.');
    });

    test('electron runtime allows loopback targets', async () => {
      pool.execute.mockResolvedValueOnce([[{
        id: 'host-123',
        userId: 'user-123',
        name: 'Loopback Electron Test',
        host: '127.0.0.1',
        port: 22,
        username: 'root',
        authType: 'password',
        credentialId: null,
      }]]);

      const { token } = issueConnectToken({
        userId: 'user-123',
        hostId: 'host-123',
        runtime: 'electron',
        purpose: 'ssh',
        authType: 'password',
      });

      const result = await authorizeConnectRequest('user-123', {
        hostId: 'host-123',
        runtime: 'electron',
        purpose: 'ssh',
        authType: 'password',
        connectToken: token,
      });

      expect(result.host.host).toBe('127.0.0.1');
    });

    test('electron runtime allows private LAN targets', async () => {
      pool.execute.mockResolvedValueOnce([[{
        id: 'host-123',
        userId: 'user-123',
        name: 'Private Electron Test',
        host: '10.0.2.15',
        port: 22,
        username: 'root',
        authType: 'password',
        credentialId: null,
      }]]);

      const { token } = issueConnectToken({
        userId: 'user-123',
        hostId: 'host-123',
        runtime: 'electron',
        purpose: 'ssh',
        authType: 'password',
      });

      const result = await authorizeConnectRequest('user-123', {
        hostId: 'host-123',
        runtime: 'electron',
        purpose: 'ssh',
        authType: 'password',
        connectToken: token,
      });

      expect(result.host.host).toBe('10.0.2.15');
    });

    test('browser runtime keeps public remote host behavior unchanged', async () => {
      pool.execute.mockResolvedValueOnce([[{
        id: 'host-123',
        userId: 'user-123',
        name: 'Public Remote Test',
        host: '8.8.8.8',
        port: 22,
        username: 'root',
        authType: 'password',
        credentialId: null,
      }]]);

      const { token } = issueConnectToken({
        userId: 'user-123',
        hostId: 'host-123',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
      });

      const result = await authorizeConnectRequest('user-123', {
        hostId: 'host-123',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        connectToken: token,
      });

      expect(result.host.host).toBe('8.8.8.8');
    });

    test('blocks unspecified / wildcard target 0.0.0.0 connection attempts', async () => {
      pool.execute.mockResolvedValueOnce([[{
        id: 'host-123',
        userId: 'user-123',
        name: 'Local Test',
        host: '0.0.0.0',
        port: 22,
        username: 'root',
        authType: 'password',
        credentialId: null,
      }]]);

      const { token } = issueConnectToken({
        userId: 'user-123',
        hostId: 'host-123',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
      });

      await expect(
        authorizeConnectRequest('user-123', {
          hostId: 'host-123',
          runtime: 'browser',
          purpose: 'ssh',
          authType: 'password',
          connectToken: token,
        })
      ).rejects.toThrow('Unspecified or wildcard target addresses (0.0.0.0 / ::) are not allowed');
    });

    test('blocks unspecified / wildcard target :: connection attempts', async () => {
      pool.execute.mockResolvedValueOnce([[{
        id: 'host-123',
        userId: 'user-123',
        name: 'Local Test',
        host: '::',
        port: 22,
        username: 'root',
        authType: 'password',
        credentialId: null,
      }]]);

      const { token } = issueConnectToken({
        userId: 'user-123',
        hostId: 'host-123',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
      });

      await expect(
        authorizeConnectRequest('user-123', {
          hostId: 'host-123',
          runtime: 'browser',
          purpose: 'ssh',
          authType: 'password',
          connectToken: token,
        })
      ).rejects.toThrow('Unspecified or wildcard target addresses (0.0.0.0 / ::) are not allowed');
    });
  });

  describe('LocalBridgeSessionManager', () => {
    test('rejects connection targets that are unspecified (0.0.0.0 or ::)', () => {
      const manager = new LocalBridgeSessionManager();
      expect(() => {
        manager.createSession('test-token', '0.0.0.0', 22, { approved: true });
      }).toThrow('Unspecified or wildcard target addresses (0.0.0.0 / ::) are not allowed');

      expect(() => {
        manager.createSession('test-token', '::', 22, { approved: true });
      }).toThrow('Unspecified or wildcard target addresses (0.0.0.0 / ::) are not allowed');
    });

    test('rejects binding local bridge listener to unspecified addresses (0.0.0.0 or ::)', () => {
      const manager = new LocalBridgeSessionManager();
      expect(() => {
        manager.createSession('test-token', '127.0.0.1', 22, { bindHost: '0.0.0.0', approved: true });
      }).toThrow('Local bridge listener must bind only to a loopback address');

      expect(() => {
        manager.createSession('test-token', '127.0.0.1', 22, { bindHost: '::', approved: true });
      }).toThrow('Local bridge listener must bind only to a loopback address');
    });

    test('rejects non-approved local bridge session', () => {
      const manager = new LocalBridgeSessionManager();
      expect(() => {
        manager.createSession('test-token-no-approval', '127.0.0.1', 22, { bindHost: '127.0.0.1' });
      }).toThrow('Local bridge requires explicit per-target approval');
    });

    test('allows private LAN target with explicit approval and performs short TTL cleanup', async () => {
      const manager = new LocalBridgeSessionManager();
      const session = await manager.createSession('test-token-valid', '192.168.56.10', 22, {
        bindHost: '127.0.0.1',
        ttlMs: 50,
        approved: true,
      });

      expect(session.localPort).toBeGreaterThan(0);
      expect(manager.sessions.has('test-token-valid')).toBe(true);

      // Wait for TTL expiration
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(manager.sessions.has('test-token-valid')).toBe(false);
    });
  });

  describe('API bind policy', () => {
    test('does not force production API bind host to loopback when local bridge is disabled', () => {
      expect(validateApiBindHost('0.0.0.0', { ENABLE_LOCALHOST_BRIDGE: 'false' })).toEqual({
        ok: true,
        enforced: false,
      });
      expect(validateApiBindHost('10.0.0.5', {})).toEqual({
        ok: true,
        enforced: false,
      });
    });

    test('rejects wildcard and external bind hosts for local bridge runtime', () => {
      expect(validateApiBindHost('0.0.0.0', { ENABLE_LOCALHOST_BRIDGE: 'true' }).ok).toBe(false);
      expect(validateApiBindHost('::', { ENABLE_LOCALHOST_BRIDGE: 'true' }).ok).toBe(false);
      expect(validateApiBindHost('10.0.0.5', { IS_LOCAL_BRIDGE: 'true' }).ok).toBe(false);
    });

    test('allows loopback bind hosts for local bridge runtime', () => {
      expect(validateApiBindHost('127.0.0.1', { ENABLE_LOCALHOST_BRIDGE: 'true' })).toEqual({
        ok: true,
        enforced: true,
      });
      expect(validateApiBindHost('::1', { IS_LOCAL_BRIDGE: 'true' })).toEqual({
        ok: true,
        enforced: true,
      });
    });
  });
});
