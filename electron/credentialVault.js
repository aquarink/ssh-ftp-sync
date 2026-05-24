const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

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
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is not available on this desktop session');
  }
  const vault = readVault();
  vault[vaultKey(userId, credentialId)] = safeStorage.encryptString(JSON.stringify(secret)).toString('base64');
  writeVault(vault);
}

function readCredentialSecret(userId, credentialId) {
  const vault = readVault();
  const entry = vault[vaultKey(userId, credentialId)] || vault[credentialId];
  if (!entry) throw new Error('Credential secret is unavailable');
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(entry, 'base64')));
  } catch {
    throw new Error('Credential secret is unavailable');
  }
}

function removeCredentialSecret(userId, credentialId) {
  const vault = readVault();
  delete vault[vaultKey(userId, credentialId)];
  delete vault[credentialId];
  writeVault(vault);
}

module.exports = { readCredentialSecret, removeCredentialSecret, saveCredentialSecret };
