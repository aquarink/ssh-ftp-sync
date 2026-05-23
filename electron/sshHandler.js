const { ipcMain } = require('electron');
const { runSftpOperation } = require('../server/sftpService');
const { readCredentialSecret, removeCredentialSecret, saveCredentialSecret } = require('./credentialVault');
const { TerminalSessionManager } = require('./terminalSessionManager');

const terminalSessions = new TerminalSessionManager();

ipcMain.on('ssh-connect', (event, { id, hostId, host, port, username, password, privateKey, credentialId }) => {
  let resolvedSecret = {};
  try {
    if (!password && !privateKey && credentialId) {
      resolvedSecret = readCredentialSecret(credentialId);
    }
  } catch (error) {
    event.reply('ssh-error', { id, message: error.message });
    return;
  }

  terminalSessions.connect(id, { hostId, host, port, username, password, privateKey, ...resolvedSecret }, {
    onConnected: (sessionId) => event.reply('ssh-connected', { id: sessionId }),
    onError: (sessionId, error) => event.reply('ssh-error', { id: sessionId, message: error.message }),
    onClosed: (sessionId) => event.reply('ssh-closed', { id: sessionId }),
    onData: (sessionId, data) => event.reply('ssh-data', { id: sessionId, data }),
  });
});

ipcMain.handle('credential-save-secret', async (event, { id, secret }) => {
  saveCredentialSecret(id, secret);
  return { ok: true };
});

ipcMain.handle('credential-remove-secret', async (event, { id }) => {
  removeCredentialSecret(id);
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
