const fs = require('fs');
const path = require('path');
const { createCipheriv, createDecipheriv, randomBytes } = require('crypto');
const {
  ensureVaultDir,
  getVaultDir,
  isVaultReady,
  getVaultKeyBuffer,
} = require('./credentialStore');

function fileModeWarning(mode, label) {
  const unsafeBits = mode & 0o077;
  if (unsafeBits === 0) return null;
  return `${label} permissions are broader than recommended`;
}

function testVaultCrypto() {
  const key = getVaultKeyBuffer();
  const iv = randomBytes(12);
  const payload = JSON.stringify({ ok: true, at: new Date().toISOString() });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  return decrypted === payload;
}

function vaultHealthCheck() {
  const checkedAt = new Date().toISOString();
  const warning = [];
  let storageReady = false;
  let encryptionReady = false;
  let testEncryptDecryptOk = false;

  try {
    ensureVaultDir();
    storageReady = true;
    const dirStat = fs.statSync(getVaultDir());
    const dirWarning = fileModeWarning(dirStat.mode, 'Vault directory');
    if (dirWarning) warning.push(dirWarning);
  } catch (error) {
    warning.push('Vault directory is not ready');
  }

  encryptionReady = isVaultReady();
  if (!encryptionReady) {
    warning.push('Vault encryption key is not configured');
  } else {
    try {
      testEncryptDecryptOk = testVaultCrypto();
    } catch {
      warning.push('Vault crypto roundtrip failed');
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
  vaultHealthCheck,
};
