const { authorizeConnectRequest, isLoopbackAddress } = require('../accessPolicy');
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

describe('Localhost Bridge POC Security Policy', () => {
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
      expect(isLoopbackAddress('0.0.0.0')).toBe(false); // CRITICAL: unspecified/wildcard is NOT loopback
      expect(isLoopbackAddress('::')).toBe(false);      // CRITICAL: unspecified/wildcard is NOT loopback
      expect(isLoopbackAddress('example.com')).toBe(false);
      expect(isLoopbackAddress('192.168.1.1')).toBe(false);
      expect(isLoopbackAddress('8.8.8.8')).toBe(false);
      expect(isLoopbackAddress(null)).toBe(false);
      expect(isLoopbackAddress(undefined)).toBe(false);
    });
  });

  describe('authorizeConnectRequest - Loopback & Local Bridge Constraints', () => {
    test('blocks loopback targets in browser mode when ENABLE_LOCALHOST_BRIDGE is false', async () => {
      process.env.ENABLE_LOCALHOST_BRIDGE = 'false';
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
      ).rejects.toThrow('Loopback target not allowed in remote browser relay');
    });

    test('allows loopback targets in browser mode when ENABLE_LOCALHOST_BRIDGE is true (local bridge mode)', async () => {
      process.env.ENABLE_LOCALHOST_BRIDGE = 'true';
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

      const result = await authorizeConnectRequest('user-123', {
        hostId: 'host-123',
        runtime: 'browser',
        purpose: 'ssh',
        authType: 'password',
        connectToken: token,
      });

      expect(result.host.host).toBe('127.0.0.1');
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
        manager.createSession('test-token', '0.0.0.0', 22);
      }).toThrow('Unspecified or wildcard target addresses (0.0.0.0 / ::) are not allowed');

      expect(() => {
        manager.createSession('test-token', '::', 22);
      }).toThrow('Unspecified or wildcard target addresses (0.0.0.0 / ::) are not allowed');
    });

    test('rejects binding local bridge listener to unspecified addresses (0.0.0.0 or ::)', () => {
      const manager = new LocalBridgeSessionManager();
      expect(() => {
        manager.createSession('test-token', '127.0.0.1', 22, { bindHost: '0.0.0.0' });
      }).toThrow('Local bridge listener must bind only to a loopback address');

      expect(() => {
        manager.createSession('test-token', '127.0.0.1', 22, { bindHost: '::' });
      }).toThrow('Local bridge listener must bind only to a loopback address');
    });

    test('allows binding listener to valid loopback address and performs short TTL cleanup', async () => {
      const manager = new LocalBridgeSessionManager();
      const session = await manager.createSession('test-token-valid', '127.0.0.1', 22, {
        bindHost: '127.0.0.1',
        ttlMs: 50,
      });

      expect(session.localPort).toBeGreaterThan(0);
      expect(manager.sessions.has('test-token-valid')).toBe(true);

      // Wait for TTL expiration
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(manager.sessions.has('test-token-valid')).toBe(false);
    });
  });
});
