const fs = require('fs');
const path = require('path');
const { createCipheriv, createDecipheriv, createHash, createPrivateKey, randomBytes } = require('crypto');

const vaultDir = process.env.CREDENTIAL_VAULT_DIR || path.join(__dirname, '..', '.credential-vault');
const defaultVaultKey = 'development-credential-vault-key-change-me';

function vaultKey() {
  return createHash('sha256')
    .update(process.env.CREDENTIAL_VAULT_KEY || process.env.SESSION_SECRET || defaultVaultKey)
    .digest();
}

function ensureVaultDir() {
  fs.mkdirSync(vaultDir, { recursive: true, mode: 0o700 });
}

function storagePath(storageRef) {
  const name = path.basename(storageRef);
  if (name !== storageRef) throw new Error('Invalid credential storage reference');
  return path.join(vaultDir, name);
}

function encryptSecret(secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', vaultKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(secret), 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  };
}

function decryptSecret(payload) {
  const decipher = createDecipheriv('aes-256-gcm', vaultKey(), Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(payload.data, 'base64')),
    decipher.final(),
  ]).toString('utf8'));
}

function saveCredentialSecret(credentialId, secret) {
  ensureVaultDir();
  const storageRef = `${credentialId}.json`;
  fs.writeFileSync(storagePath(storageRef), JSON.stringify(encryptSecret(secret)), { mode: 0o600 });
  return storageRef;
}

function readCredentialSecret(storageRef) {
  return decryptSecret(JSON.parse(fs.readFileSync(storagePath(storageRef), 'utf8')));
}

function removeCredentialSecret(storageRef) {
  try {
    fs.unlinkSync(storagePath(storageRef));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function privateKeyFingerprint(privateKey, passphrase) {
  const keyObject = createPrivateKey({ key: privateKey, passphrase: passphrase || undefined });
  const publicDer = keyObject.export({ type: 'spki', format: 'der' });
  return `SHA256:${createHash('sha256').update(publicDer).digest('base64').replace(/=+$/, '')}`;
}

function validatePrivateKey(privateKey, passphrase) {
  if (typeof privateKey !== 'string' || !privateKey.includes('PRIVATE KEY')) {
    throw Object.assign(new Error('Private key must be OpenSSH or PEM format'), { status: 400 });
  }
  try {
    return privateKeyFingerprint(privateKey, passphrase);
  } catch {
    throw Object.assign(new Error('Private key or passphrase is invalid'), { status: 400 });
  }
}

module.exports = {
  privateKeyFingerprint,
  readCredentialSecret,
  removeCredentialSecret,
  saveCredentialSecret,
  validatePrivateKey,
};
