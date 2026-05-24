const { ipcMain } = require('electron');
const { Client } = require('ssh2');
const { runSftpOperation } = require('../server/sftpService');
const { removeCredentialSecret, saveCredentialSecret } = require('./credentialVault');
const { TerminalSessionManager } = require('./terminalSessionManager');
const { resolveIdentity } = require('./identityResolver');
const { electronVaultHealthCheck } = require('./vaultHealth');
const { logIdentityEvent, logVaultEvent } = require('./securityLog');

const terminalSessions = new TerminalSessionManager();
let activeUserId = null;
// TODO(security): prefer authenticated app/session context over renderer-supplied userId whenever the desktop shell can derive it directly.

function resolveDesktopUserId(rendererUserId) {
  const effectiveUserId = activeUserId || rendererUserId;
  if (!effectiveUserId) {
    throw new Error('Authenticated user context is unavailable');
  }
  if (activeUserId && rendererUserId && activeUserId !== rendererUserId) {
    throw new Error('Renderer user context does not match authenticated session context');
  }
  return effectiveUserId;
}

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
      authenticatedUserId: activeUserId,
      hostId,
      hostUserId,
      runtime: 'electron',
      authType,
      credentialId,
      purpose: purpose || 'ssh',
    });

    logIdentityEvent('connect', {
      userId: resolved.userId,
      hostId,
      credentialId,
      authType,
      runtime: 'electron',
      purpose: purpose || 'ssh',
      result: 'ok',
    });

    terminalSessions.connect(id, {
      userId: resolved.userId,
      hostId,
      hostUserId: resolved.userId,
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

ipcMain.handle('session-context-set', async (event, { userId }) => {
  if (!userId) {
    activeUserId = null;
    return { ok: true };
  }
  activeUserId = userId;
  return { ok: true };
});

ipcMain.handle('session-context-clear', async () => {
  activeUserId = null;
  return { ok: true };
});

ipcMain.handle('credential-save-secret', async (event, { userId, id, secret }) => {
  const effectiveUserId = resolveDesktopUserId(userId);
  saveCredentialSecret(effectiveUserId, id, secret);
  return { ok: true };
});

ipcMain.handle('identity-save-secret', async (event, { userId, id, secret }) => {
  const effectiveUserId = resolveDesktopUserId(userId);
  saveCredentialSecret(effectiveUserId, id, secret);
  return { ok: true };
});

ipcMain.handle('credential-remove-secret', async (event, { userId, id }) => {
  const effectiveUserId = resolveDesktopUserId(userId);
  removeCredentialSecret(effectiveUserId, id);
  return { ok: true };
});

ipcMain.handle('identity-remove-secret', async (event, { userId, id }) => {
  const effectiveUserId = resolveDesktopUserId(userId);
  removeCredentialSecret(effectiveUserId, id);
  return { ok: true };
});

ipcMain.handle('identity-test', async (event, { userId, hostUserId, hostId, credentialId, authType, host, port, username }) => {
  const resolved = resolveIdentity({
    userId,
    authenticatedUserId: activeUserId,
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
  logIdentityEvent('test', {
    userId: resolved.userId,
    hostId,
    credentialId,
    authType,
    runtime: 'electron',
    purpose: 'test_connection',
    result: 'ok',
  });
  return { ok: true };
});

ipcMain.handle('vault-health', async () => {
  const result = electronVaultHealthCheck();
  logVaultEvent('health', {
    result: result.ok ? 'ok' : 'warn',
    storageReady: result.storageReady,
    encryptionReady: result.encryptionReady,
    testEncryptDecryptOk: result.testEncryptDecryptOk,
  });
  return result;
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
