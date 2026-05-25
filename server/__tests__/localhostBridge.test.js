const { authorizeConnectRequest, isLoopbackAddress } = require('../accessPolicy');
const { pool } = require('../db');
const { issueConnectToken } = require('../connectToken');

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
      expect(isLoopbackAddress('0.0.0.0')).toBe(true);
      expect(isLoopbackAddress('::')).toBe(true);
    });

    test('identifies non-loopback hostnames and IPs', () => {
      expect(isLoopbackAddress('example.com')).toBe(false);
      expect(isLoopbackAddress('192.168.1.1')).toBe(false);
      expect(isLoopbackAddress('8.8.8.8')).toBe(false);
      expect(isLoopbackAddress(null)).toBe(false);
      expect(isLoopbackAddress(undefined)).toBe(false);
    });
  });

  describe('authorizeConnectRequest - Loopback & Local Bridge Constraints', () => {
    const mockUser = { id: 'user-123' };
    const mockTokenPayload = {
      userId: 'user-123',
      hostId: 'host-123',
      runtime: 'browser',
      purpose: 'ssh',
      authType: 'password',
    };

    test('blocks loopback targets in browser mode when ENABLE_LOCALHOST_BRIDGE is false (remote server)', async () => {
      process.env.ENABLE_LOCALHOST_BRIDGE = 'false';

      // Mock host lookup to return localhost
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

      // Issue a valid token
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

      // Mock host lookup to return localhost
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

      // Issue a valid token
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

    test('allows loopback targets in electron mode even when ENABLE_LOCALHOST_BRIDGE is false', async () => {
      process.env.ENABLE_LOCALHOST_BRIDGE = 'false';

      // Mock host lookup to return localhost
      pool.execute.mockResolvedValueOnce([[{
        id: 'host-123',
        userId: 'user-123',
        name: 'Local Test',
        host: 'localhost',
        port: 22,
        username: 'root',
        authType: 'password',
        credentialId: null,
      }]]);

      // Issue a valid token
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

      expect(result.host.host).toBe('localhost');
    });

    test('blocks non-loopback targets when ENABLE_LOCALHOST_BRIDGE is true (local bridge mode)', async () => {
      process.env.ENABLE_LOCALHOST_BRIDGE = 'true';

      // Mock host lookup to return a remote address
      pool.execute.mockResolvedValueOnce([[{
        id: 'host-123',
        userId: 'user-123',
        name: 'Remote Test',
        host: 'example.com',
        port: 22,
        username: 'root',
        authType: 'password',
        credentialId: null,
      }]]);

      // Issue a valid token
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
      ).rejects.toThrow('Local bridge is restricted to loopback targets only');
    });
  });
});
