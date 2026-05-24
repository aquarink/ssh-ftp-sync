const http = require('http');
const { randomUUID } = require('crypto');
const { Client } = require('ssh2');
const { pool } = require('./db');
const {
  createSession,
  destroySession,
  expiredSessionCookieHeader,
  getSessionUser,
  hashPassword,
  sessionCookieHeader,
  verifyPassword,
} = require('./auth');
const { verifySignupEmail } = require('./emailVerification');
const { validateTurnstile } = require('./turnstile');
const { attachSshWebSocket } = require('./sshWebSocket');
const { runSftpOperation } = require('./sftpService');
const { resolveIdentity } = require('./identityResolver');
const { isEphemeralCredentialExpired } = require('./ephemeralCredential');
const { cleanupSessionsByUser, getSessionMetrics } = require('./sessionLifecycle');
const { vaultHealthCheck } = require('./vaultHealth');
const {
  authorizeConnectRequest,
  issueConnectAuthorization,
  invalidateConnectAuthorizationsByHost,
  invalidateConnectAuthorizationsByIdentity,
  invalidateConnectAuthorizationsByUser,
} = require('./accessPolicy');
const { getSecurityMetrics } = require('./securityMetrics');
const { logIdentityEvent, redactSecretFields } = require('./securityLog');
const {
  removeCredentialSecret,
  saveCredentialSecret,
  validateCertificate,
  validatePrivateKey,
  validatePublicKey,
} = require('./credentialStore');

const port = Number(process.env.API_PORT || 8790);
const maxBodyBytes = 50 * 1024 * 1024;

function json(res, status, payload, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBodyBytes) {
      throw Object.assign(new Error('Request body is too large'), { status: 413 });
    }
  }

  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { status: 400 });
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw Object.assign(new Error('Password must be at least 8 characters'), { status: 400 });
  }
}

function hostPayload(body) {
  const host = String(body.host || '').trim();
  const username = String(body.username || '').trim();
  const name = String(body.name || host).trim();
  const port = Number.parseInt(body.port, 10) || 22;
  const password = typeof body.password === 'string' ? body.password : '';
  const authType = ['password', 'private_key', 'private_key_passphrase', 'key_with_certificate', 'certificate', 'agent', 'one_time', 'identity', 'credential'].includes(body.authType)
    ? body.authType
    : 'password';
  const credentialId = typeof body.credentialId === 'string' && body.credentialId ? body.credentialId : null;
  const startupDirectory = String(body.startupDirectory || '').trim() || null;
  const notes = String(body.notes || '').trim() || null;
  const tags = String(body.tags || '').trim() || null;

  if (!host || !username || !name) {
    throw Object.assign(new Error('Host, name, and username are required'), { status: 400 });
  }
  if (port < 1 || port > 65535) {
    throw Object.assign(new Error('Port must be between 1 and 65535'), { status: 400 });
  }
  if (authType === 'one_time') {
    throw Object.assign(new Error('Authentication method is not supported yet'), { status: 400 });
  }
  if (authType !== 'password' && authType !== 'one_time' && !credentialId) {
    throw Object.assign(new Error('Credential is required for the selected authentication method'), { status: 400 });
  }

  return { host, username, name, port, password, authType, credentialId, startupDirectory, notes, tags };
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    approvalStatus: user.approval_status,
  };
}

function publicHost(row) {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.authType,
    credentialId: row.credentialId,
    startupDirectory: row.startupDirectory,
    notes: row.notes,
    tags: row.tags,
    updatedAt: row.updatedAt,
  };
}

function buildConnectConfig(host, material, extra = {}) {
  return {
    host: host.host,
    port: host.port || 22,
    username: host.username,
    password: material?.password || undefined,
    privateKey: material?.privateKey || undefined,
    passphrase: material?.passphrase || undefined,
    cert: material?.certificate || material?.cert || undefined,
    agent: material?.agent || undefined,
    readyTimeout: 15000,
    keepaliveInterval: 25000,
    keepaliveCountMax: 3,
    ...extra,
  };
}

async function requireUser(req, res) {
  const user = await getSessionUser(req);
  if (!user) {
    json(res, 401, { error: 'Authentication required' });
    return null;
  }
  return user;
}

async function requireAdmin(req, res) {
  const user = await requireUser(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    json(res, 403, { error: 'Administrator access required' });
    return null;
  }
  return user;
}

function publicManagedUser(user) {
  return {
    ...publicUser(user),
    createdAt: user.created_at,
    emailCheckResult: user.email_check_result,
    emailSafeToSend: user.email_safe_to_send === null ? null : Boolean(user.email_safe_to_send),
  };
}

async function register(req, res) {
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  await validateTurnstile(req, body.turnstileToken);
  validatePassword(body.password);

  if (!email || !email.includes('@')) {
    throw Object.assign(new Error('A valid email is required'), { status: 400 });
  }

  const emailCheck = await verifySignupEmail(email);
  const user = { id: randomUUID(), email };
  try {
    await pool.execute(
      `INSERT INTO users
        (id, email, password_hash, email_check_result, email_safe_to_send, email_checked_at)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [user.id, user.email, await hashPassword(body.password), emailCheck.result, emailCheck.safeToSend]
    );
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      throw Object.assign(new Error('Email is already registered'), { status: 409 });
    }
    throw error;
  }

  json(res, 201, {
    ok: true,
    message: 'Registration received. Wait for administrator approval before signing in.',
  });
}

async function login(req, res) {
  const body = await readJson(req);
  await validateTurnstile(req, body.turnstileToken);
  const identifier = normalizeEmail(body.identifier || body.email);
  const [rows] = await pool.execute(
    `SELECT id, email, username, password_hash, role, approval_status
       FROM users
      WHERE email = ? OR username = ?
      LIMIT 1`,
    [identifier, identifier]
  );
  const user = rows[0];
  if (!user || !(await verifyPassword(body.password || '', user.password_hash))) {
    throw Object.assign(new Error('Incorrect email or password'), { status: 401 });
  }
  if (user.approval_status === 'rejected') {
    throw Object.assign(new Error('This account was rejected by an administrator'), { status: 403 });
  }
  if (user.approval_status !== 'approved') {
    throw Object.assign(new Error('This account is waiting for administrator approval'), { status: 403 });
  }

  const token = await createSession(user.id);
  json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookieHeader(token, req) });
}

async function changePassword(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  const body = await readJson(req);
  validatePassword(body.newPassword);
  const [rows] = await pool.execute('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [user.id]);
  if (!rows[0] || !(await verifyPassword(body.currentPassword || '', rows[0].password_hash))) {
    throw Object.assign(new Error('Current password is incorrect'), { status: 400 });
  }

  await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [
    await hashPassword(body.newPassword),
    user.id,
  ]);
  json(res, 200, { ok: true });
}

async function listUsers(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const [users] = await pool.execute(
    `SELECT id, email, username, role, approval_status, created_at,
            email_check_result, email_safe_to_send
       FROM users
      ORDER BY created_at DESC`
  );
  json(res, 200, { users: users.map(publicManagedUser) });
}

async function reviewUser(req, res, id) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const body = await readJson(req);
  if (!['approved', 'rejected'].includes(body.approvalStatus)) {
    throw Object.assign(new Error('Approval status must be approved or rejected'), { status: 400 });
  }
  if (id === admin.id && body.approvalStatus === 'rejected') {
    throw Object.assign(new Error('Administrator cannot reject the active account'), { status: 400 });
  }

  await pool.execute('UPDATE users SET approval_status = ? WHERE id = ? AND role <> ?', [
    body.approvalStatus,
    id,
    'admin',
  ]);
  if (body.approvalStatus === 'rejected') {
    await pool.execute('DELETE FROM sessions WHERE user_id = ?', [id]);
  }
  const [rows] = await pool.execute(
    `SELECT id, email, username, role, approval_status, created_at,
            email_check_result, email_safe_to_send
       FROM users
      WHERE id = ?
      LIMIT 1`,
    [id]
  );
  if (!rows[0]) throw Object.assign(new Error('User not found'), { status: 404 });
  json(res, 200, { user: publicManagedUser(rows[0]) });
}

async function listHosts(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  const [hosts] = await pool.execute(
    `SELECT id, user_id AS userId, name, host, port, username, auth_type AS authType, credential_id AS credentialId,
            startup_directory AS startupDirectory, notes, tags, updated_at AS updatedAt
       FROM hosts
      WHERE user_id = ?
      ORDER BY created_at ASC`,
    [user.id]
  );
  json(res, 200, { hosts: hosts.map(publicHost) });
}

async function ensureUserCredential(userId, credentialId) {
  if (!credentialId) return null;
  const [rows] = await pool.execute(
    'SELECT id, user_id FROM ssh_credentials WHERE id = ? LIMIT 1',
    [credentialId]
  );
  const row = rows[0];
  if (!row) throw Object.assign(new Error('Identity not found'), { status: 404 });
  if (row.user_id !== userId) throw Object.assign(new Error('Identity does not belong to user'), { status: 403 });
  return row;
}

async function createHost(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  const host = { id: randomUUID(), ...hostPayload(await readJson(req)) };
  await ensureUserCredential(user.id, host.credentialId);
  host.userId = user.id;
  host.password = '';

  await pool.execute(
    `INSERT INTO hosts
      (id, user_id, name, host, port, username, auth_type, credential_id, startup_directory, notes, tags, password)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [host.id, user.id, host.name, host.host, host.port, host.username, host.authType, host.credentialId, host.startupDirectory, host.notes, host.tags, host.password]
  );
  json(res, 201, { host: publicHost({
    ...host,
    userId: user.id,
    updatedAt: null,
    startupDirectory: host.startupDirectory,
    credentialId: host.credentialId,
    authType: host.authType,
  }) });
}

async function updateHost(req, res, id) {
  const user = await requireUser(req, res);
  if (!user) return;

  const [existingRows] = await pool.execute(
    `SELECT id, credential_id
       FROM hosts
      WHERE id = ? AND user_id = ?
      LIMIT 1`,
    [id, user.id]
  );
  if (!existingRows[0]) throw Object.assign(new Error('Host not found'), { status: 404 });

  const body = await readJson(req);
  const host = hostPayload(body);
  if (body.removeCredential) {
    host.credentialId = null;
    host.authType = 'password';
  }

  await ensureUserCredential(user.id, host.credentialId);
  await pool.execute(
    `UPDATE hosts
        SET name = ?,
            host = ?,
            port = ?,
            username = ?,
            auth_type = ?,
            credential_id = ?,
            startup_directory = ?,
            notes = ?,
            tags = ?,
            password = ''
      WHERE id = ? AND user_id = ?`,
    [host.name, host.host, host.port, host.username, host.authType, host.credentialId, host.startupDirectory, host.notes, host.tags, id, user.id]
  );
  invalidateConnectAuthorizationsByHost(user.id, id, 'host_updated');

  const [rows] = await pool.execute(
    `SELECT id, user_id AS userId, name, host, port, username, auth_type AS authType, credential_id AS credentialId,
            startup_directory AS startupDirectory, notes, tags, updated_at AS updatedAt
       FROM hosts
      WHERE id = ? AND user_id = ?
      LIMIT 1`,
    [id, user.id]
  );
  json(res, 200, { host: publicHost(rows[0]) });
}

function publicCredential(row) {
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    username: row.username,
    fingerprint: row.fingerprint,
    publicKeyFingerprint: row.public_key_fingerprint,
    certificateFingerprint: row.certificate_fingerprint,
    notes: row.notes,
    assignedHostCount: Number(row.assigned_host_count || 0),
    lastUsedAt: row.last_used_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listIdentities(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const [rows] = await pool.execute(
    `SELECT c.id, c.type, c.label, c.username, c.fingerprint, c.public_key_fingerprint, c.certificate_fingerprint, c.notes, c.created_at, c.updated_at,
            NULL AS last_used_at,
            (
              SELECT COUNT(*)
                FROM hosts h
               WHERE h.credential_id = c.id
                 AND h.user_id = c.user_id
            ) AS assigned_host_count
       FROM ssh_credentials c
      WHERE c.user_id = ?
      ORDER BY c.created_at DESC`,
    [user.id]
  );
  const identities = rows.map(publicCredential);
  json(res, 200, { identities, credentials: identities });
}

function identityPayload(body) {
  const type = ['password', 'private_key', 'private_key_passphrase', 'key_pair', 'certificate', 'key_with_certificate', 'agent', 'one_time'].includes(body.type) ? body.type : 'private_key';
  const label = String(body.label || '').trim();
  const username = String(body.username || '').trim() || null;
  const notes = String(body.notes || '').trim() || null;
  const runtime = String(body.runtime || 'browser').toLowerCase() === 'electron' ? 'electron' : 'browser';
  if (!label) throw Object.assign(new Error('Identity label is required'), { status: 400 });

  let secret = { type };
  let fingerprint = null;
  let publicKeyFingerprint = null;
  let certificateFingerprint = null;
  let secretProvided = false;

  if (type === 'password') {
    if (typeof body.password !== 'string' || !body.password) {
      throw Object.assign(new Error('Password is required'), { status: 400 });
    }
    secret = { type, password: body.password };
    secretProvided = true;
  }
  if (['private_key', 'private_key_passphrase', 'key_pair', 'key_with_certificate'].includes(type)) {
    fingerprint = validatePrivateKey(body.privateKey, body.passphrase);
    publicKeyFingerprint = validatePublicKey(body.publicKey);
    secret = {
      type: type === 'key_pair' ? 'private_key' : type,
      privateKey: body.privateKey,
      publicKey: body.publicKey || '',
      passphrase: body.passphrase || '',
    };
    secretProvided = true;
  }
  if (['certificate', 'key_with_certificate'].includes(type)) {
    certificateFingerprint = validateCertificate(body.certificate);
    secret = { ...secret, certificate: body.certificate || '' };
    secretProvided = true;
  }
  if (type === 'agent') {
    if (runtime === 'browser') {
      throw Object.assign(new Error('Authentication method is not supported in browser runtime'), { status: 400 });
    }
    secret = { type, agent: process.platform === 'win32' ? 'pageant' : (process.env.SSH_AUTH_SOCK || '') };
    secretProvided = true;
  }
  if (type === 'one_time') {
    throw Object.assign(new Error('Authentication method is not supported yet'), { status: 400 });
  }

  return { type, label, username, notes, secret, fingerprint, publicKeyFingerprint, certificateFingerprint, runtime, secretProvided };
}

async function createIdentity(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const id = randomUUID();
  const identity = identityPayload(await readJson(req));
  const storageRef = `${id}.json`;
  if (identity.secretProvided && identity.runtime === 'browser') {
    saveCredentialSecret(id, identity.secret);
  }
  await pool.execute(
    `INSERT INTO ssh_credentials
      (id, user_id, type, label, username, fingerprint, public_key_fingerprint, certificate_fingerprint, notes, storage_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, user.id, identity.type, identity.label, identity.username, identity.fingerprint, identity.publicKeyFingerprint, identity.certificateFingerprint, identity.notes, storageRef]
  );
  const [rows] = await pool.execute(
    `SELECT id, type, label, username, fingerprint, public_key_fingerprint, certificate_fingerprint, notes, created_at, updated_at,
            NULL AS last_used_at,
            0 AS assigned_host_count
       FROM ssh_credentials
      WHERE id = ? AND user_id = ?
      LIMIT 1`,
    [id, user.id]
  );
  const publicIdentity = publicCredential(rows[0]);
  logIdentityEvent('create', {
    userId: user.id,
    credentialId: publicIdentity.id,
    authType: publicIdentity.type,
    runtime: identity.runtime,
    purpose: 'save',
    result: 'ok',
  });
  json(res, 201, { identity: publicIdentity, credential: publicIdentity });
}

async function getIdentity(req, res, id) {
  const user = await requireUser(req, res);
  if (!user) return;
  const [rows] = await pool.execute(
    `SELECT c.id, c.type, c.label, c.username, c.fingerprint, c.public_key_fingerprint, c.certificate_fingerprint, c.notes, c.created_at, c.updated_at,
            NULL AS last_used_at,
            (
              SELECT COUNT(*)
                FROM hosts h
               WHERE h.credential_id = c.id
                 AND h.user_id = c.user_id
            ) AS assigned_host_count
       FROM ssh_credentials c
      WHERE c.id = ? AND c.user_id = ?
      LIMIT 1`,
    [id, user.id]
  );
  if (!rows[0]) throw Object.assign(new Error('Identity not found'), { status: 404 });
  json(res, 200, { identity: publicCredential(rows[0]), credential: publicCredential(rows[0]) });
}

async function updateIdentity(req, res, id) {
  const user = await requireUser(req, res);
  if (!user) return;
  const body = await readJson(req);
  const label = String(body.label || '').trim();
  const username = String(body.username || '').trim() || null;
  const notes = String(body.notes || '').trim() || null;
  if (!label) throw Object.assign(new Error('Identity label is required'), { status: 400 });
  await pool.execute(
    `UPDATE ssh_credentials
        SET label = ?, username = ?, notes = ?
      WHERE id = ? AND user_id = ?`,
    [label, username, notes, id, user.id]
  );
  logIdentityEvent('update', {
    userId: user.id,
    credentialId: id,
    result: 'ok',
  });
  return getIdentity(req, res, id);
}

async function deleteIdentity(req, res, id) {
  const user = await requireUser(req, res);
  if (!user) return;
  const [rows] = await pool.execute(
    'SELECT storage_ref FROM ssh_credentials WHERE id = ? AND user_id = ? LIMIT 1',
    [id, user.id]
  );
  if (!rows[0]) throw Object.assign(new Error('Identity not found'), { status: 404 });
  removeCredentialSecret(rows[0].storage_ref);
  await pool.execute('DELETE FROM ssh_credentials WHERE id = ? AND user_id = ?', [id, user.id]);
  invalidateConnectAuthorizationsByIdentity(user.id, id, 'identity_deleted');
  logIdentityEvent('delete', {
    userId: user.id,
    credentialId: id,
    result: 'ok',
  });
  json(res, 200, { ok: true });
}

async function assignIdentityToHost(req, res, hostId) {
  const user = await requireUser(req, res);
  if (!user) return;
  const body = await readJson(req);
  const identityId = typeof body.identityId === 'string' && body.identityId ? body.identityId : null;
  const authType = identityId ? 'identity' : 'password';
  const [hosts] = await pool.execute(
    'SELECT id FROM hosts WHERE id = ? AND user_id = ? LIMIT 1',
    [hostId, user.id]
  );
  if (!hosts[0]) throw Object.assign(new Error('Host not found'), { status: 404 });
  if (identityId) {
    await ensureUserCredential(user.id, identityId);
  }
  await pool.execute(
    'UPDATE hosts SET auth_type = ?, credential_id = ?, password = \'\' WHERE id = ? AND user_id = ?',
    [authType, identityId, hostId, user.id]
  );
  invalidateConnectAuthorizationsByHost(user.id, hostId, 'host_identity_changed');
  logIdentityEvent('assign', {
    userId: user.id,
    hostId,
    credentialId: identityId,
    authType,
    result: 'ok',
  });
  const [updated] = await pool.execute(
    `SELECT id, user_id AS userId, name, host, port, username, auth_type AS authType, credential_id AS credentialId,
            startup_directory AS startupDirectory, notes, tags, updated_at AS updatedAt
       FROM hosts
      WHERE id = ? AND user_id = ?
      LIMIT 1`,
    [hostId, user.id]
  );
  json(res, 200, { host: publicHost(updated[0]) });
}

function testSshConnection(host, resolved, context = {}) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timer = setTimeout(() => {
      conn.end();
      reject(Object.assign(new Error('Connection failed after credential resolution'), { status: 400 }));
    }, 15000);

    const finishWithFailure = (error) => {
      clearTimeout(timer);
      console.error('test-ssh-failed', redactSecretFields({
        host,
        username,
        port,
        message: error?.message || 'Connection failed after credential resolution',
      }));
      reject(Object.assign(new Error('Connection failed after credential resolution'), { status: 400 }));
    };

    conn.once('ready', () => {
      clearTimeout(timer);
      conn.end();
      resolve();
    });
    conn.once('error', finishWithFailure);
    try {
      conn.connect(buildConnectConfig(host, resolved.ephemeralCredential.material));
    } finally {
      const cleared = resolved.ephemeralCredential.clear();
      logIdentityEvent(cleared ? 'credentialCleared' : 'credentialClearFailed', {
        userId: context.userId || null,
        hostId: context.hostId || host?.id || null,
        credentialId: context.credentialId || resolved.credential?.id || resolved.ephemeralCredential.id,
        sessionId: context.sessionId || resolved.ephemeralCredential.sessionId,
        runtime: resolved.runtime,
        purpose: resolved.purpose,
        authType: resolved.authType,
        result: cleared ? 'ok' : 'error',
        timestamp: new Date().toISOString(),
      });
    }
  });
}

async function testIdentity(req, res, id) {
  const user = await requireUser(req, res);
  if (!user) return;
  const body = await readJson(req);
  const host = String(body.host || '').trim();
  const username = String(body.username || '').trim();
  const port = Number.parseInt(body.port, 10) || 22;
  if (!host || !username) throw Object.assign(new Error('Host and username are required'), { status: 400 });
  const resolved = await resolveIdentity({
    userId: user.id,
    hostId: null,
    runtime: String(body.runtime || 'browser').toLowerCase() === 'electron' ? 'electron' : 'browser',
    authType: body.authType || null,
    credentialId: id,
    purpose: 'test_connection',
    sessionId: `test-${id}`,
  });
  try {
    if (!resolved.ephemeralCredential) {
      throw Object.assign(new Error('Credential secret unavailable'), { status: 400 });
    }
    if (isEphemeralCredentialExpired(resolved.ephemeralCredential)) {
      logIdentityEvent('credentialExpired', {
        userId: user.id,
        hostId: null,
        credentialId: resolved.credential?.id || resolved.ephemeralCredential.id,
        sessionId: resolved.ephemeralCredential.sessionId,
        runtime: resolved.runtime,
        purpose: 'test_connection',
        authType: resolved.authType,
        result: 'error',
        timestamp: new Date().toISOString(),
      });
      resolved.ephemeralCredential.clear();
      throw Object.assign(new Error('Credential secret unavailable'), { status: 400 });
    }

    await testSshConnection(
      { host, username, port },
      resolved,
      { userId: user.id, hostId: null, credentialId: id, sessionId: resolved.ephemeralCredential.sessionId }
    );
    logIdentityEvent('credentialUsedForPurpose', {
      userId: user.id,
      credentialId: resolved.credential?.id || resolved.ephemeralCredential.id,
      sessionId: resolved.ephemeralCredential.sessionId,
      runtime: resolved.runtime,
      purpose: 'test_connection',
      authType: resolved.authType,
      result: 'ok',
      timestamp: new Date().toISOString(),
    });
    json(res, 200, {
      ok: true,
      authType: resolved.authType,
      fingerprint: resolved.credential?.fingerprint || resolved.credential?.publicKeyFingerprint || resolved.credential?.certificateFingerprint || null,
      message: 'Credential material cleared after use',
    });
  } catch (error) {
    logIdentityEvent('credentialUsedForPurpose', {
      userId: user.id,
      credentialId: resolved.credential?.id || resolved.ephemeralCredential?.id || id,
      sessionId: resolved.ephemeralCredential?.sessionId || `test-${id}`,
      runtime: resolved.runtime,
      purpose: 'test_connection',
      authType: resolved.authType,
      result: 'error',
      timestamp: new Date().toISOString(),
    });
    throw Object.assign(new Error('Connection failed after credential resolution'), { status: error.status || 400 });
  } finally {
    if (resolved.ephemeralCredential && !resolved.ephemeralCredential.cleared) {
      const cleared = resolved.ephemeralCredential.clear();
      logIdentityEvent(cleared ? 'credentialCleared' : 'credentialClearFailed', {
        userId: user.id,
        credentialId: resolved.credential?.id || resolved.ephemeralCredential.id,
        sessionId: resolved.ephemeralCredential.sessionId,
        runtime: resolved.runtime,
        purpose: 'test_connection',
        authType: resolved.authType,
        result: cleared ? 'ok' : 'error',
        timestamp: new Date().toISOString(),
      });
    }
  }
}

async function deleteHost(req, res, id) {
  const user = await requireUser(req, res);
  if (!user) return;

  await pool.execute('DELETE FROM hosts WHERE id = ? AND user_id = ?', [id, user.id]);
  invalidateConnectAuthorizationsByHost(user.id, id, 'host_deleted');
  json(res, 200, { ok: true });
}

async function sftpOperation(req, res, hostId, operation) {
  const user = await requireUser(req, res);
  if (!user) return;

  const payload = await readJson(req);
  let authorization = null;
  let resolved = null;
  try {
    authorization = await authorizeConnectRequest(user.id, {
      hostId,
      runtime: 'browser',
      purpose: 'sftp',
      authType: payload.authType || null,
      credentialId: payload.credentialId || null,
      connectToken: payload.connectToken || null,
    });
    resolved = await resolveIdentity({
      userId: user.id,
      hostId: authorization.host.id,
      runtime: authorization.runtime,
      authType: authorization.authType,
      credentialId: authorization.credentialId,
      purpose: authorization.purpose,
    });
    if (!resolved.ephemeralCredential) {
      throw Object.assign(new Error('Credential secret unavailable'), { status: 400 });
    }
    if (isEphemeralCredentialExpired(resolved.ephemeralCredential)) {
      resolved.ephemeralCredential.clear();
      logIdentityEvent('credentialExpired', {
        userId: user.id,
        hostId: resolved.host?.id || hostId,
        credentialId: resolved.credential?.id || resolved.ephemeralCredential.id,
        sessionId: resolved.ephemeralCredential.sessionId,
        runtime: resolved.runtime,
        purpose: resolved.purpose,
        authType: resolved.authType,
        result: 'error',
        timestamp: new Date().toISOString(),
      });
      throw Object.assign(new Error('Credential secret unavailable'), { status: 400 });
    }

    logIdentityEvent('credentialUsedForPurpose', {
      userId: user.id,
      hostId: resolved.host?.id || hostId,
      credentialId: resolved.credential?.id || resolved.ephemeralCredential.id,
      sessionId: resolved.ephemeralCredential.sessionId,
      runtime: resolved.runtime,
      purpose: resolved.purpose,
      authType: resolved.authType,
      result: 'ok',
      timestamp: new Date().toISOString(),
    });

    const result = await runSftpOperation({
      host: {
        id: authorization.host.id,
        host: authorization.host.host,
        port: authorization.host.port,
        username: authorization.host.username,
      },
      credential: resolved.ephemeralCredential,
      sessionMeta: {
        sessionId: resolved.ephemeralCredential.sessionId,
        userId: user.id,
        hostId: resolved.host?.id || hostId,
        credentialId: resolved.credential?.id || resolved.ephemeralCredential.id,
        runtime: resolved.runtime,
        purpose: resolved.purpose,
      },
    }, operation, payload);
    json(res, 200, result);
  } catch (error) {
    logIdentityEvent('credentialUsedForPurpose', {
      userId: user.id,
      hostId: resolved?.host?.id || authorization?.host?.id || hostId,
      credentialId: resolved?.credential?.id || resolved?.ephemeralCredential?.id || null,
      sessionId: resolved?.ephemeralCredential?.sessionId || `sftp-${hostId}`,
      runtime: resolved?.runtime || authorization?.runtime || 'browser',
      purpose: resolved?.purpose || authorization?.purpose || 'sftp',
      authType: resolved?.authType || authorization?.authType || null,
      result: 'error',
      timestamp: new Date().toISOString(),
    });
    if (!error.status || error.status >= 500) {
      console.error('sftp-error', redactSecretFields({
        userId: user.id,
        hostId,
        operation,
        message: error.message,
      }));
    }
    throw error;
  } finally {
    if (resolved?.ephemeralCredential && !resolved.ephemeralCredential.cleared) {
      const cleared = resolved.ephemeralCredential.clear();
      logIdentityEvent(cleared ? 'credentialCleared' : 'credentialClearFailed', {
        userId: user.id,
        hostId: resolved.host?.id || authorization?.host?.id || hostId,
        credentialId: resolved.credential?.id || resolved.ephemeralCredential.id,
        sessionId: resolved.ephemeralCredential.sessionId,
        runtime: resolved.runtime,
        purpose: resolved.purpose,
        authType: resolved.authType,
        result: cleared ? 'ok' : 'error',
        timestamp: new Date().toISOString(),
      });
    }
  }
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/api/health') {
    await pool.query('SELECT 1');
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET' && url.pathname === '/api/auth/session') {
    const user = await getSessionUser(req);
    return json(res, 200, { user: user ? publicUser(user) : null });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/register') return register(req, res);
  if (req.method === 'POST' && url.pathname === '/api/auth/login') return login(req, res);
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const user = await getSessionUser(req);
    if (user) {
      cleanupSessionsByUser(user.id, 'logout');
      invalidateConnectAuthorizationsByUser(user.id, 'logout');
    }
    await destroySession(req);
    return json(res, 200, { ok: true }, { 'Set-Cookie': expiredSessionCookieHeader(req) });
  }
  if (req.method === 'PUT' && url.pathname === '/api/auth/password') return changePassword(req, res);
  if (req.method === 'GET' && url.pathname === '/api/hosts') return listHosts(req, res);
  if (req.method === 'POST' && url.pathname === '/api/hosts') return createHost(req, res);
  if (req.method === 'GET' && (url.pathname === '/api/credentials' || url.pathname === '/api/identities')) return listIdentities(req, res);
  if (req.method === 'POST' && (url.pathname === '/api/credentials' || url.pathname === '/api/identities')) return createIdentity(req, res);
  if (req.method === 'GET' && url.pathname === '/api/admin/users') return listUsers(req, res);
  if (req.method === 'GET' && url.pathname === '/api/security/vault-health') {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    return json(res, 200, vaultHealthCheck());
  }
  if (req.method === 'GET' && url.pathname === '/api/security/session-metrics') {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const sessionMetrics = getSessionMetrics();
    return json(res, 200, { ok: true, metrics: { ...sessionMetrics, access: getSecurityMetrics(sessionMetrics) } });
  }
  if (req.method === 'GET' && url.pathname === '/api/security/access-metrics') {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const sessionMetrics = getSessionMetrics();
    return json(res, 200, { ok: true, metrics: getSecurityMetrics(sessionMetrics) });
  }
  if (req.method === 'POST' && url.pathname === '/api/security/connect-token') {
    const user = await requireUser(req, res);
    if (!user) return;
    const token = await issueConnectAuthorization(user.id, await readJson(req));
    return json(res, 201, token);
  }
  if (req.method === 'POST' && url.pathname === '/api/security/connect-token/consume') {
    const body = await readJson(req);
    const authorization = await authorizeConnectRequest(body.userId || null, body);
    return json(res, 200, { ok: true, ...authorization });
  }

  const hostId = url.pathname.match(/^\/api\/hosts\/([^/]+)$/);
  if (req.method === 'PUT' && hostId) {
    return updateHost(req, res, decodeURIComponent(hostId[1]));
  }
  if (req.method === 'DELETE' && hostId) {
    return deleteHost(req, res, decodeURIComponent(hostId[1]));
  }
  const hostIdentity = url.pathname.match(/^\/api\/hosts\/([^/]+)\/identity$/);
  if (req.method === 'PUT' && hostIdentity) {
    return assignIdentityToHost(req, res, decodeURIComponent(hostIdentity[1]));
  }
  const identityId = url.pathname.match(/^\/api\/(?:credentials|identities)\/([^/]+)$/);
  if (identityId) {
    if (req.method === 'GET') return getIdentity(req, res, decodeURIComponent(identityId[1]));
    if (req.method === 'PUT') return updateIdentity(req, res, decodeURIComponent(identityId[1]));
    if (req.method === 'DELETE') return deleteIdentity(req, res, decodeURIComponent(identityId[1]));
  }
  const identityTest = url.pathname.match(/^\/api\/(?:credentials|identities)\/([^/]+)\/test$/);
  if (req.method === 'POST' && identityTest) {
    return testIdentity(req, res, decodeURIComponent(identityTest[1]));
  }
  const sftpMatch = url.pathname.match(/^\/api\/hosts\/([^/]+)\/sftp\/([a-z]+)$/);
  if (req.method === 'POST' && sftpMatch) {
    return sftpOperation(req, res, decodeURIComponent(sftpMatch[1]), sftpMatch[2]);
  }
  const approvalId = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/approval$/);
  if (req.method === 'PUT' && approvalId) {
    return reviewUser(req, res, decodeURIComponent(approvalId[1]));
  }

  return json(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    if (!error.status || error.status >= 500) {
      console.error('api-error', redactSecretFields({
        status: error.status || 500,
        message: error.message,
        code: error.code || null,
      }));
    }
    const payload = {
      error: error.status ? error.message : 'Internal server error',
    };
    if (!error.status && (error.code || error.sqlMessage)) {
      payload.details = error.code || error.sqlMessage;
    }
    json(res, error.status || 500, {
      ...payload,
    });
  });
});

attachSshWebSocket(server);

server.listen(port, '127.0.0.1', () => {
  console.log(`Ant Tech Async API listening on http://127.0.0.1:${port}`);
});
