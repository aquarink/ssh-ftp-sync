const fs = require('fs');
const path = require('path');
const { createCipheriv, createDecipheriv, createHash, randomBytes } = require('crypto');
const { utils: { parseKey } } = require('ssh2');

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
  try {
    return decryptSecret(JSON.parse(fs.readFileSync(storagePath(storageRef), 'utf8')));
  } catch {
    throw Object.assign(new Error('Credential secret is unavailable'), { status: 400 });
  }
}

function removeCredentialSecret(storageRef) {
  try {
    fs.unlinkSync(storagePath(storageRef));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function sshBlobFingerprint(value) {
  const parts = String(value || '').trim().split(/\s+/);
  if (parts.length < 2) throw Object.assign(new Error('Invalid SSH public key format'), { status: 400 });
  return `SHA256:${createHash('sha256').update(Buffer.from(parts[1], 'base64')).digest('base64').replace(/=+$/, '')}`;
}

function validatePrivateKey(privateKey, passphrase) {
  if (typeof privateKey !== 'string' || !/-----BEGIN (OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/.test(privateKey)) {
    throw Object.assign(new Error('Private key must be OpenSSH or PEM format'), { status: 400 });
  }
  const parsed = parseKey(privateKey, passphrase || undefined);
  if (parsed instanceof Error) {
    throw Object.assign(new Error('Private key or passphrase is invalid'), { status: 400 });
  }
  const key = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!key?.isPrivateKey?.()) throw Object.assign(new Error('Private key is invalid'), { status: 400 });
  return sshBlobFingerprint(key.getPublicSSH());
}

function validatePublicKey(publicKey) {
  if (!publicKey) return null;
  const key = String(publicKey).trim();
  if (!/^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp(256|384|521))\s+/.test(key)) {
    throw Object.assign(new Error('Unsupported public key format'), { status: 400 });
  }
  const parsed = parseKey(key);
  if (parsed instanceof Error) throw Object.assign(new Error('Public key is invalid'), { status: 400 });
  return sshBlobFingerprint(key);
}

function validateCertificate(certificate) {
  if (!certificate) return null;
  const cert = String(certificate).trim();
  if (!/^(ssh-rsa-cert-v01@openssh\.com|ssh-ed25519-cert-v01@openssh\.com|ecdsa-sha2-nistp(256|384|521)-cert-v01@openssh\.com)\s+/.test(cert)) {
    throw Object.assign(new Error('Unsupported OpenSSH certificate format'), { status: 400 });
  }
  return sshBlobFingerprint(cert);
}

module.exports = {
  readCredentialSecret,
  removeCredentialSecret,
  saveCredentialSecret,
  validateCertificate,
  validatePrivateKey,
  validatePublicKey,
};
