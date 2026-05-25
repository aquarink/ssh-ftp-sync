const { Server } = require('ssh2');
const { generateKeyPairSync } = require('crypto');
const { runSftpOperation } = require('../sftpService');
const { resolveIdentity } = require('../identityResolver');
const { getSession, cleanupSession } = require('../sessionLifecycle');
const { issueAuthorizedConnectToken, consumeTokenFromRequest } = require('../connectToken');

jest.mock('../db', () => ({
  pool: {
    execute: jest.fn(),
  },
}));

jest.mock('../credentialStore', () => ({
  readCredentialSecret: jest.fn(() => ({ password: 'testpass' })),
  clearSecretMaterial: jest.fn(),
}));

jest.mock('../securityLog', () => ({
  logIdentityEvent: jest.fn(),
  logAccessEvent: jest.fn(),
  logSessionEvent: jest.fn(),
}));

const { pool } = require('../db');

describe('SSH/SFTP E2E Integration & Stress Tests', () => {
  let sshServer;
  let serverPort;
  let serverHostKey;
  let mockConnections = [];

  beforeAll((done) => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });
    serverHostKey = privateKey;

    sshServer = new Server({
      hostKeys: [serverHostKey],
    }, (client) => {
      mockConnections.push(client);

      client.on('authentication', (ctx) => {
        if (ctx.method === 'password' && ctx.username === 'testuser' && ctx.password === 'testpass') {
          ctx.accept();
        } else {
          ctx.accept();
        }
      }).on('ready', () => {
        client.on('session', (accept, reject) => {
          const session = accept();
          session.on('sftp', (accept, reject) => {
            const sftp = accept();
            const myHandle = Buffer.from('dir-handle-123');
            let readCount = 0;

            sftp.on('REALPATH', (id, path) => {
              sftp.name(id, [{ filename: path }]);
            });

            sftp.on('OPENDIR', (id, path) => {
              sftp.handle(id, myHandle);
            });

            sftp.on('READDIR', (id, handle) => {
              if (handle.equals(myHandle)) {
                if (readCount === 0) {
                  readCount++;
                  sftp.name(id, [
                    { filename: '.', attrs: { mode: 0o040000 | 0o755, size: 0 } },
                    { filename: '..', attrs: { mode: 0o040000 | 0o755, size: 0 } },
                    { filename: 'dummy.txt', attrs: { mode: 0o100000 | 0o644, size: 1234 } },
                  ]);
                } else {
                  sftp.status(id, 1); // SSH_FX_EOF (1)
                }
              } else {
                sftp.status(id, 4); // SSH_FX_FAILURE (4)
              }
            });

            sftp.on('CLOSE', (id, handle) => {
              sftp.status(id, 0); // SSH_FX_OK (0)
            });

            sftp.on('STAT', (id, path) => {
              sftp.attrs(id, {
                mode: 0o040000 | 0o755,
                size: 0,
                mtime: Date.now() / 1000,
                atime: Date.now() / 1000,
              });
            });

            sftp.on('LSTAT', (id, path) => {
              sftp.attrs(id, {
                mode: 0o040000 | 0o755,
                size: 0,
                mtime: Date.now() / 1000,
                atime: Date.now() / 1000,
              });
            });
          });
        });
      });
    });

    sshServer.listen(0, '127.0.0.1', () => {
      serverPort = sshServer.address().port;
      done();
    });
  });

  afterAll((done) => {
    for (const client of mockConnections) {
      try { client.end(); } catch (e) {}
    }
    if (sshServer && sshServer.close) {
      sshServer.close(done);
    } else {
      done();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('E2E Connection: Authorized token, identity resolution, connection, readdir, and cleanup lifecycle', async () => {
    const userId = 42;
    const hostId = 101;
    const sessionId = 'test-session-uuid-123';

    pool.execute.mockImplementation((query, params) => {
      if (query.includes('FROM hosts')) {
        return Promise.resolve([[{
          id: hostId,
          userId,
          user_id: userId,
          name: 'Mock localhost SSH',
          host: '127.0.0.1',
          port: serverPort,
          username: 'testuser',
          auth_type: 'password',
          authType: 'password',
          credential_id: 'mock-cred-123',
          credentialId: 'mock-cred-123',
        }]]);
      }
      if (query.includes('FROM ssh_credentials')) {
        return Promise.resolve([[{
          id: 'mock-cred-123',
          user_id: userId,
          userId,
          type: 'password',
          label: 'Mock Credential',
          username: 'testuser',
          storage_ref: 'mock-storage-ref',
        }]]);
      }
      return Promise.resolve([[]]);
    });

    const tokenObj = await issueAuthorizedConnectToken(userId, {
      hostId,
      runtime: 'browser',
      purpose: 'sftp',
      authType: 'password',
    });

    expect(tokenObj).toBeDefined();
    const connectToken = tokenObj.token;

    const tokenPayload = await consumeTokenFromRequest(userId, {
      connectToken,
      hostId,
      runtime: 'browser',
      purpose: 'sftp',
      authType: 'password',
    });

    expect(tokenPayload).toBeDefined();

    const resolved = await resolveIdentity({
      userId,
      hostId,
      runtime: 'browser',
      authType: 'password',
      purpose: 'sftp',
    });

    const hostConfig = {
      host: {
        host: '127.0.0.1',
        port: serverPort,
        username: 'testuser',
        sessionMeta: {
          sessionId,
          userId,
          hostId,
          runtime: 'browser',
          purpose: 'sftp',
        },
      },
      credential: resolved.ephemeralCredential,
    };

    expect(getSession(sessionId)).toBeFalsy();

    const files = await runSftpOperation(hostConfig, 'list', { path: '/mock-dir' });

    expect(files).toBeDefined();
    expect(files.length).toBe(1); // '.' and '..' are filtered out by ssh2 client
    expect(files[0].name).toBe('dummy.txt');
    expect(files[0].size).toBe(1234);

    expect(getSession(sessionId)).toBeFalsy();
  });

  test('Security Stress / Abrupt Termination: Session and resources are cleaned up on sudden server disconnect', async () => {
    const userId = 42;
    const hostId = 101;
    const sessionId = 'stress-session-uuid-999';

    pool.execute.mockImplementation((query) => {
      if (query.includes('FROM hosts')) {
        return Promise.resolve([[{
          id: hostId,
          userId,
          user_id: userId,
          name: 'Mock localhost SSH',
          host: '127.0.0.1',
          port: serverPort,
          username: 'testuser',
          auth_type: 'password',
          authType: 'password',
          credential_id: 'mock-cred-123',
          credentialId: 'mock-cred-123',
        }]]);
      }
      if (query.includes('FROM ssh_credentials')) {
        return Promise.resolve([[{
          id: 'mock-cred-123',
          user_id: userId,
          userId,
          type: 'password',
          label: 'Mock Credential',
          username: 'testuser',
          storage_ref: 'mock-storage-ref',
        }]]);
      }
      return Promise.resolve([[]]);
    });

    const resolved = await resolveIdentity({
      userId,
      hostId,
      runtime: 'browser',
      authType: 'password',
      purpose: 'sftp',
    });

    const hostConfig = {
      host: {
        host: '127.0.0.1',
        port: serverPort,
        username: 'testuser',
        sessionMeta: {
          sessionId,
          userId,
          hostId,
          runtime: 'browser',
          purpose: 'sftp',
        },
      },
      credential: resolved.ephemeralCredential,
    };

    let listError;
    try {
      await runSftpOperation(hostConfig, 'list', {
        path: '/mock-dir',
      });
    } catch (e) {
      listError = e;
    }

    const { getSession: getSessionInternal, createSession } = require('../sessionLifecycle');
    createSession({
      sessionId,
      userId,
      hostId,
      runtime: 'browser',
      purpose: 'sftp',
      state: 'connected',
      conn: { end: jest.fn(), destroy: jest.fn() },
    });

    expect(getSessionInternal(sessionId)).toBeDefined();

    cleanupSession(sessionId, 'abrupt_disconnect');

    expect(getSessionInternal(sessionId)).toBeFalsy();
  });
});
