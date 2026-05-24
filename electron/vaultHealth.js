const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

function electronVaultHealthCheck() {
  const checkedAt = new Date().toISOString();
  const warning = [];
  let storageReady = false;
  let encryptionReady = false;
  let testEncryptDecryptOk = false;

  try {
    const vaultDir = app.getPath('userData');
    const vaultFile = path.join(vaultDir, 'ssh-credential-vault.json');
    storageReady = true;
    if (fs.existsSync(vaultFile)) {
      const stat = fs.statSync(vaultFile);
      if ((stat.mode & 0o077) !== 0) {
        warning.push('Electron vault file permissions are broader than recommended');
      }
    }
  } catch {
    warning.push('Electron vault storage is not ready');
  }

  encryptionReady = safeStorage.isEncryptionAvailable();
  if (!encryptionReady) {
    warning.push('Electron secure storage is not available');
  } else {
    try {
      const probe = `vault-probe:${checkedAt}`;
      const encrypted = safeStorage.encryptString(probe);
      const decrypted = safeStorage.decryptString(encrypted);
      testEncryptDecryptOk = decrypted === probe;
    } catch {
      warning.push('Electron vault crypto roundtrip failed');
    }
  }

  return {
    ok: storageReady && encryptionReady && testEncryptDecryptOk,
    storageReady,
    encryptionReady,
    testEncryptDecryptOk,
    warning,
    checkedAt,
  };
}

module.exports = {
  electronVaultHealthCheck,
};
