const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const { logVaultEvent } = require('./securityLog');
const { clearSecretMaterial } = require('./secretLifecycle');

function vaultPath() {
  return path.join(app.getPath('userData'), 'ssh-credential-vault.json');
}

function readVault() {
  try {
    return JSON.parse(fs.readFileSync(vaultPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeVault(vault) {
  fs.writeFileSync(vaultPath(), JSON.stringify(vault, null, 2), { mode: 0o600 });
}

function vaultKey(userId, credentialId) {
  return `${userId}:${credentialId}`;
}

function saveCredentialSecret(userId, credentialId, secret) {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Vault is not ready');
    }
    const vault = readVault();
    vault[vaultKey(userId, credentialId)] = safeStorage.encryptString(JSON.stringify(secret)).toString('base64');
    writeVault(vault);
    logVaultEvent('save', { userId, credentialId, result: 'ok' });
  } catch {
    throw new Error('Vault is not ready');
  } finally {
    clearSecretMaterial(secret);
  }
}

function readCredentialSecret(userId, credentialId) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Vault is not ready');
  }
  const vault = readVault();
  const entry = vault[vaultKey(userId, credentialId)] || vault[credentialId];
  if (!entry) {
    throw new Error('Credential secret unavailable');
  }
  try {
    const secret = JSON.parse(safeStorage.decryptString(Buffer.from(entry, 'base64')));
    logVaultEvent('read', { userId, credentialId, result: 'ok' });
    return secret;
  } catch {
    throw new Error('Failed to decrypt credential');
  }
}

function removeCredentialSecret(userId, credentialId) {
  try {
    const vault = readVault();
    delete vault[vaultKey(userId, credentialId)];
    delete vault[credentialId];
    writeVault(vault);
    logVaultEvent('remove', { userId, credentialId, result: 'ok' });
  } catch {
    throw new Error('Vault is not ready');
  }
}

module.exports = { readCredentialSecret, removeCredentialSecret, saveCredentialSecret };
