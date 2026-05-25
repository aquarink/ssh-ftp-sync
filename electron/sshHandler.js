const { BrowserWindow, ipcMain, session } = require('electron');
const { Client } = require('ssh2');
const { runSftpOperation } = require('../server/sftpService');
const { isLoopbackAddress, isUnspecifiedAddress } = require('../server/accessPolicy');
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

async function getAuthenticatedUserId(event) {
  if (process.env.NODE_ENV === 'test') {
    return activeUserId || 'test-user-id';
  }

  const webContents = event?.sender;
  if (!webContents) {
    throw new Error('Sender webContents not found');
  }

  const cookies = await webContents.session.cookies.get({
    url: `http://127.0.0.1:${apiPort}`,
    name: 'ats_session',
  });

  if (cookies.length === 0) {
    throw new Error('No active session cookie found');
  }

  const token = cookies[0].value;
  const response = await fetch(`http://127.0.0.1:${apiPort}/api/auth/session`, {
    headers: {
      'Cookie': `ats_session=${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to verify session with backend');
  }

  const data = await response.json().catch(() => ({}));
  if (!data?.user?.id) {
    throw new Error('Session is invalid or expired');
  }

  return data.user.id;
}

async function resolveDesktopUserId(event, rendererUserId) {
  const authenticatedUserId = await getAuthenticatedUserId(event);
  if (!authenticatedUserId) {
    throw new Error('Authenticated user context is unavailable');
  }
  if (rendererUserId && authenticatedUserId !== rendererUserId) {
    throw new Error('Renderer user context does not match authenticated session context');
  }
  return authenticatedUserId;
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
    const { id, userId, hostId, authType, credentialId, purpose, connectToken, host } = payload;
    let authorization = null;
    let resolved = null;
    try {
      if (isUnspecifiedAddress(host)) {
        throw new Error('Unspecified or wildcard target addresses (0.0.0.0 / ::) are not allowed as connection targets');
      }
      if (process.env.ENABLE_LOCALHOST_BRIDGE === 'true' && !isLoopbackAddress(host)) {
        throw new Error('Local bridge is restricted to loopback targets only');
      }
      const windowId = BrowserWindow.fromWebContents(event.sender)?.id || null;
      const effectiveUserId = await resolveDesktopUserId(event, userId);
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
        authenticatedUserId: effectiveUserId,
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
  try {
    const verifiedUserId = await getAuthenticatedUserId(event);
    if (userId && verifiedUserId !== userId) {
      throw new Error('Renderer user context does not match authenticated session context');
    }
    activeUserId = verifiedUserId;
    return { ok: true };
  } catch (error) {
    activeUserId = null;
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('session-context-clear', async () => {
  activeUserId = null;
  return { ok: true };
});

ipcMain.handle('credential-save-secret', async (event, { userId, id, secret }) => {
  const effectiveUserId = await resolveDesktopUserId(event, userId);
  saveCredentialSecret(effectiveUserId, id, secret);
  return { ok: true };
});

ipcMain.handle('identity-save-secret', async (event, { userId, id, secret }) => {
  const effectiveUserId = await resolveDesktopUserId(event, userId);
  saveCredentialSecret(effectiveUserId, id, secret);
  return { ok: true };
});

ipcMain.handle('credential-remove-secret', async (event, { userId, id }) => {
  const effectiveUserId = await resolveDesktopUserId(event, userId);
  removeCredentialSecret(effectiveUserId, id);
  return { ok: true };
});

ipcMain.handle('identity-remove-secret', async (event, { userId, id }) => {
  const effectiveUserId = await resolveDesktopUserId(event, userId);
  removeCredentialSecret(effectiveUserId, id);
  return { ok: true };
});

ipcMain.handle('identity-test', async (event, { userId, hostUserId, hostId, credentialId, authType, host, port, username }) => {
  if (isUnspecifiedAddress(host)) {
    throw new Error('Unspecified or wildcard target addresses (0.0.0.0 / ::) are not allowed as connection targets');
  }
  if (process.env.ENABLE_LOCALHOST_BRIDGE === 'true' && !isLoopbackAddress(host)) {
    throw new Error('Local bridge is restricted to loopback targets only');
  }
  const effectiveUserId = await resolveDesktopUserId(event, userId);
  const resolved = await resolveIdentity({
    userId: effectiveUserId,
    authenticatedUserId: effectiveUserId,
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
  const effectiveUserId = await resolveDesktopUserId(event, userId);
  cleanupSessionsByUser(effectiveUserId, reason || 'logout');
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
  const authType = payload?.authType ?? session.authType ?? null;
  const credentialId = payload?.credentialId ?? session.credentialId ?? null;

  try {
    const authenticatedUserId = await getAuthenticatedUserId(event);
    if (session.userId !== authenticatedUserId) {
      throw new Error('Session does not belong to the authenticated user');
    }
    authorization = await consumeConnectToken({
      userId: session.userId,
      hostId: session.hostId,
      runtime: 'electron',
      purpose: 'sftp',
      authType,
      credentialId,
      connectToken: payload?.connectToken,
    });
    resolved = await resolveIdentity({
      userId: session.userId,
      authenticatedUserId,
      hostId: session.hostId,
      hostUserId: session.userId,
      runtime: 'electron',
      authType: authorization.authType || authType,
      credentialId: authorization.credentialId || credentialId,
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
          credentialId: authorization.credentialId || credentialId || resolved.credential?.id || null,
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
