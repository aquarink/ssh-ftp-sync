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

function saveCredentialSecret(id, secret) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is not available on this desktop session');
  }
  const vault = readVault();
  vault[id] = safeStorage.encryptString(JSON.stringify(secret)).toString('base64');
  writeVault(vault);
}

function readCredentialSecret(id) {
  const vault = readVault();
  if (!vault[id]) throw new Error('Credential secret is not available in this OS keychain');
  return JSON.parse(safeStorage.decryptString(Buffer.from(vault[id], 'base64')));
}

function removeCredentialSecret(id) {
  const vault = readVault();
  delete vault[id];
  writeVault(vault);
}

module.exports = { readCredentialSecret, removeCredentialSecret, saveCredentialSecret };
