const { BrowserWindow, ipcMain } = require('electron');
const { Client } = require('ssh2');
const { runSftpOperation } = require('../server/sftpService');
const { removeCredentialSecret, saveCredentialSecret } = require('./credentialVault');
const { TerminalSessionManager } = require('./terminalSessionManager');
const { resolveIdentity } = require('./identityResolver');
const { isEphemeralCredentialExpired } = require('./ephemeralCredential');
const { electronVaultHealthCheck } = require('./vaultHealth');
const {
  cleanupAllSessions,
  cleanupSession,
  cleanupSessionsByUser,
  cleanupSessionsByWindowId,
  getSessionMetrics,
} = require('./sessionLifecycle');
const { logIdentityEvent, logVaultEvent } = require('./securityLog');

const terminalSessions = new TerminalSessionManager();
let activeUserId = null;
// TODO(security): prefer authenticated app/session context over renderer-supplied userId whenever the desktop shell can derive it directly.
const apiPort = Number(process.env.API_PORT || 8790);

async function consumeConnectToken(payload) {
  const response = await fetch(`http://127.0.0.1:${apiPort}/api/security/connect-token/consume`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(data.error || data.message || 'Connect authorization failed'), { status: response.status });
  }
  return data;
}

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

function buildConnectConfig(config, material) {
  return {
    host: config.host,
    port: config.port || 22,
    username: config.username,
    password: material?.password || undefined,
    privateKey: material?.privateKey || undefined,
    passphrase: material?.passphrase || undefined,
    cert: material?.certificate || material?.cert || undefined,
    agent: material?.agent || undefined,
    readyTimeout: 15000,
  };
}

function testSshConnection(config, resolved) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timer = setTimeout(() => {
      conn.end();
      reject(Object.assign(new Error('Connection failed after credential resolution'), { status: 400 }));
    }, 15000);
    if (!resolved.ephemeralCredential) {
      clearTimeout(timer);
      reject(Object.assign(new Error('Credential secret unavailable'), { status: 400 }));
      return;
    }
    if (isEphemeralCredentialExpired(resolved.ephemeralCredential)) {
      clearTimeout(timer);
      resolved.ephemeralCredential.clear();
      logIdentityEvent('credentialExpired', {
        userId: resolved.userId,
        hostId: resolved.hostId || null,
        credentialId: resolved.credential?.id || resolved.ephemeralCredential.id,
        sessionId: resolved.ephemeralCredential.sessionId || 'test',
        runtime: resolved.runtime,
        purpose: resolved.purpose,
        authType: resolved.authType,
        result: 'error',
        timestamp: new Date().toISOString(),
      });
      reject(Object.assign(new Error('Credential secret unavailable'), { status: 400 }));
      return;
    }
    conn.once('ready', () => {
      clearTimeout(timer);
      conn.end();
      resolve();
    });
    conn.once('error', (error) => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Connection failed after credential resolution'), { status: 400 }));
    });
    try {
      conn.connect(buildConnectConfig(config, resolved.ephemeralCredential.material));
    } finally {
      const cleared = resolved.ephemeralCredential.clear();
      logIdentityEvent(cleared ? 'credentialCleared' : 'credentialClearFailed', {
        userId: resolved.userId,
        hostId: resolved.hostId || null,
        credentialId: resolved.credential?.id || resolved.ephemeralCredential.id,
        sessionId: resolved.ephemeralCredential.sessionId,
        runtime: resolved.runtime,
        purpose: resolved.purpose,
        authType: resolved.authType,
        result: cleared ? 'ok' : 'error',
        timestamp: new Date().toISOString(),
      });
    }
  });
}

ipcMain.on('ssh-connect', (event, payload) => {
  void (async () => {
    const { id, userId, hostId, authType, credentialId, purpose, connectToken } = payload;
    let authorization = null;
    let resolved = null;
    try {
      const windowId = BrowserWindow.fromWebContents(event.sender)?.id || null;
      const effectiveUserId = resolveDesktopUserId(userId);
      authorization = await consumeConnectToken({
        userId: effectiveUserId,
        hostId,
        runtime: 'electron',
        purpose: purpose || 'ssh',
        authType: authType || null,
        credentialId: credentialId || null,
        connectToken,
      });
      resolved = await resolveIdentity({
        userId: effectiveUserId,
        authenticatedUserId: activeUserId,
        hostId,
        hostUserId: effectiveUserId,
        runtime: 'electron',
        authType: authorization.authType || authType,
        credentialId: authorization.credentialId || credentialId,
        purpose: authorization.purpose || purpose || 'ssh',
        sessionId: id,
      });

      logIdentityEvent('credentialUsedForPurpose', {
        userId: resolved.userId,
        hostId,
        credentialId: resolved.credential?.id || resolved.ephemeralCredential?.id || authorization.credentialId || credentialId,
        sessionId: id,
        authType: resolved.authType,
        runtime: 'electron',
        purpose: authorization.purpose || purpose || 'ssh',
        result: 'ok',
        timestamp: new Date().toISOString(),
      });

      terminalSessions.connect(id, {
        userId: resolved.userId,
        hostId,
        hostUserId: resolved.userId,
        host: payload.host,
        port: payload.port,
        username: payload.username,
        authType: resolved.authType,
        credentialId: resolved.credential?.id || authorization.credentialId || credentialId,
        runtime: 'electron',
        purpose: authorization.purpose || purpose || 'ssh',
      }, resolved.ephemeralCredential, {
        onConnected: (sessionId) => event.reply('ssh-connected', { id: sessionId }),
        onError: (sessionId, error) => event.reply('ssh-error', { id: sessionId, message: error.message }),
        onClosed: (sessionId) => event.reply('ssh-closed', { id: sessionId }),
        onData: (sessionId, data) => event.reply('ssh-data', { id: sessionId, data }),
      }, { windowId });
    } catch (error) {
      event.reply('ssh-error', { id, message: error.message });
    }
  })();
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
  const resolved = await resolveIdentity({
    userId,
    authenticatedUserId: activeUserId,
    hostId,
    hostUserId,
    runtime: 'electron',
    authType,
    credentialId,
    purpose: 'test_connection',
    sessionId: `test-${credentialId || hostId || 'identity'}`,
  });
  try {
    await testSshConnection({
      host,
      port,
      username,
    }, resolved);
    logIdentityEvent('credentialUsedForPurpose', {
      userId: resolved.userId,
      hostId,
      credentialId: resolved.credential?.id || credentialId,
      sessionId: resolved.ephemeralCredential?.sessionId || `test-${credentialId || hostId || 'identity'}`,
      authType: resolved.authType,
      runtime: 'electron',
      purpose: 'test_connection',
      result: 'ok',
      timestamp: new Date().toISOString(),
    });
    return {
      ok: true,
      authType: resolved.authType,
      fingerprint: resolved.credential?.fingerprint || resolved.credential?.publicKeyFingerprint || resolved.credential?.certificateFingerprint || null,
      message: 'Credential material cleared after use',
    };
  } catch (error) {
    logIdentityEvent('credentialUsedForPurpose', {
      userId: resolved.userId,
      hostId,
      credentialId: resolved.credential?.id || credentialId,
      sessionId: resolved.ephemeralCredential?.sessionId || `test-${credentialId || hostId || 'identity'}`,
      authType: resolved.authType,
      runtime: 'electron',
      purpose: 'test_connection',
      result: 'error',
      timestamp: new Date().toISOString(),
    });
    throw Object.assign(new Error('Connection failed after credential resolution'), { status: error.status || 400 });
  }
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

ipcMain.handle('session-cleanup-user', async (event, { userId, reason }) => {
  if (userId) {
    cleanupSessionsByUser(userId, reason || 'logout');
  }
  return { ok: true };
});

ipcMain.handle('session-cleanup-window', async (event, { windowId, reason }) => {
  if (windowId !== undefined && windowId !== null) {
    cleanupSessionsByWindowId(windowId, reason || 'window_close');
  }
  return { ok: true };
});

ipcMain.handle('session-cleanup-all', async (event, { reason }) => {
  cleanupAllSessions(reason || 'app_quit');
  return { ok: true };
});

ipcMain.handle('session-metrics', async () => {
  return { ok: true, metrics: getSessionMetrics() };
});

ipcMain.handle('sftp-operation', async (event, { sessionId, operation, payload }) => {
  const session = terminalSessions.getSessionMetadata(sessionId);
  if (!session) {
    throw new Error('SFTP session is not available. Connect the SSH tab first.');
  }
  let authorization = null;
  let resolved = null;

  try {
    authorization = await consumeConnectToken({
      userId: session.userId,
      hostId: session.hostId,
      runtime: 'electron',
      purpose: 'sftp',
      authType: session.authType || null,
      credentialId: session.credentialId || null,
      connectToken: payload?.connectToken,
    });
    resolved = await resolveIdentity({
      userId: session.userId,
      authenticatedUserId: activeUserId,
      hostId: session.hostId,
      hostUserId: session.userId,
      runtime: 'electron',
      authType: authorization.authType || session.authType,
      credentialId: authorization.credentialId || session.credentialId,
      purpose: authorization.purpose || 'sftp',
      sessionId,
    });
    logIdentityEvent('credentialUsedForPurpose', {
      userId: resolved.userId,
      hostId: session.hostId,
      credentialId: resolved.credential?.id || resolved.ephemeralCredential?.id || authorization.credentialId || session.credentialId,
      sessionId,
      runtime: 'electron',
      purpose: authorization.purpose || 'sftp',
      authType: resolved.authType,
      result: 'ok',
      timestamp: new Date().toISOString(),
    });
    return await runSftpOperation({
      host: {
        host: session.host,
        port: session.port,
        username: session.username,
      },
      credential: resolved.ephemeralCredential,
      sessionMeta: {
        sessionId,
        userId: session.userId,
        hostId: session.hostId,
        credentialId: authorization.credentialId || session.credentialId || resolved.credential?.id || null,
        runtime: 'electron',
        purpose: authorization.purpose || 'sftp',
        sharedSession: true,
      },
    }, operation, payload || {});
  } catch (error) {
    logIdentityEvent('credentialUsedForPurpose', {
      userId: resolved?.userId || session.userId,
      hostId: session.hostId,
      credentialId: resolved?.credential?.id || resolved?.ephemeralCredential?.id || authorization?.credentialId || session.credentialId,
      sessionId,
      runtime: 'electron',
      purpose: authorization?.purpose || 'sftp',
      authType: resolved?.authType || authorization?.authType || null,
      result: 'error',
      timestamp: new Date().toISOString(),
    });
    throw error;
  } finally {
    if (resolved?.ephemeralCredential && !resolved.ephemeralCredential.cleared) {
      const cleared = resolved.ephemeralCredential.clear();
      logIdentityEvent(cleared ? 'credentialCleared' : 'credentialClearFailed', {
        userId: resolved.userId,
        hostId: session.hostId,
        credentialId: resolved.credential?.id || resolved.ephemeralCredential.id,
        sessionId,
        runtime: resolved.runtime,
        purpose: authorization?.purpose || 'sftp',
        authType: resolved.authType,
        result: cleared ? 'ok' : 'error',
        timestamp: new Date().toISOString(),
      });
    }
  }
});

module.exports = {
  cleanupAllSessions,
  cleanupSession,
  cleanupSessionsByUser,
  cleanupSessionsByWindowId,
  getSessionMetrics,
  terminalSessions,
};
