const { ipcMain } = require('electron');
const { Client } = require('ssh2');
const { runSftpOperation } = require('../server/sftpService');
const { removeCredentialSecret, saveCredentialSecret } = require('./credentialVault');
const { TerminalSessionManager } = require('./terminalSessionManager');
const { resolveIdentity } = require('./identityResolver');

const terminalSessions = new TerminalSessionManager();

function testSshConnection(config) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error('SSH connection timed out'));
    }, 15000);
    conn.once('ready', () => {
      clearTimeout(timer);
      conn.end();
      resolve();
    });
    conn.once('error', (error) => {
      clearTimeout(timer);
      reject(new Error(error.message || 'SSH connection failed'));
    });
    conn.connect({
      host: config.host,
      port: config.port || 22,
      username: config.username,
      password: config.password || undefined,
      privateKey: config.privateKey || undefined,
      passphrase: config.passphrase || undefined,
      cert: config.cert || undefined,
      agent: config.agent || undefined,
      readyTimeout: 15000,
    });
  });
}

ipcMain.on('ssh-connect', (event, payload) => {
  const { id, userId, hostId, hostUserId, authType, credentialId, purpose } = payload;
  try {
    const resolved = resolveIdentity({
      userId,
      hostId,
      hostUserId,
      runtime: 'electron',
      authType,
      credentialId,
      purpose: purpose || 'ssh',
    });

    terminalSessions.connect(id, {
      userId,
      hostId,
      hostUserId,
      host: payload.host,
      port: payload.port,
      username: payload.username,
      authType,
      credentialId,
      ...resolved.connection,
    }, {
      onConnected: (sessionId) => event.reply('ssh-connected', { id: sessionId }),
      onError: (sessionId, error) => event.reply('ssh-error', { id: sessionId, message: error.message }),
      onClosed: (sessionId) => event.reply('ssh-closed', { id: sessionId }),
      onData: (sessionId, data) => event.reply('ssh-data', { id: sessionId, data }),
    });
  } catch (error) {
    event.reply('ssh-error', { id, message: error.message });
    return;
  }
});

ipcMain.handle('credential-save-secret', async (event, { userId, id, secret }) => {
  if (!userId) throw new Error('User context is required to store a credential secret');
  saveCredentialSecret(userId, id, secret);
  return { ok: true };
});

ipcMain.handle('identity-save-secret', async (event, { userId, id, secret }) => {
  if (!userId) throw new Error('User context is required to store an identity secret');
  saveCredentialSecret(userId, id, secret);
  return { ok: true };
});

ipcMain.handle('credential-remove-secret', async (event, { userId, id }) => {
  if (!userId) throw new Error('User context is required to remove a credential secret');
  removeCredentialSecret(userId, id);
  return { ok: true };
});

ipcMain.handle('identity-remove-secret', async (event, { userId, id }) => {
  if (!userId) throw new Error('User context is required to remove an identity secret');
  removeCredentialSecret(userId, id);
  return { ok: true };
});

ipcMain.handle('identity-test', async (event, { userId, hostUserId, hostId, credentialId, authType, host, port, username }) => {
  const resolved = resolveIdentity({
    userId,
    hostId,
    hostUserId,
    runtime: 'electron',
    authType,
    credentialId,
    purpose: 'test_connection',
  });
  await testSshConnection({
    host,
    port,
    username,
    ...resolved.connection,
  });
  return { ok: true };
});

ipcMain.on('ssh-input', (event, { id, data }) => {
  terminalSessions.write(id, data);
});

ipcMain.on('ssh-resize', (event, { id, cols, rows }) => {
  terminalSessions.resize(id, cols, rows);
});

ipcMain.on('ssh-disconnect', (event, { id }) => {
  terminalSessions.disconnect(id);
});

ipcMain.handle('sftp-operation', async (event, { sessionId, operation, payload }) => {
  const hostConfig = terminalSessions.getConfig(sessionId);
  if (!hostConfig) {
    throw new Error('SFTP session is not available. Connect the SSH tab first.');
  }
  return runSftpOperation(hostConfig, operation, payload || {});
});
