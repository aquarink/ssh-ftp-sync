const http = require('http');
const { randomUUID } = require('crypto');
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

const port = Number(process.env.API_PORT || 8790);
const maxBodyBytes = 1024 * 1024;

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

  if (!host || !username || !name) {
    throw Object.assign(new Error('Host, name, and username are required'), { status: 400 });
  }
  if (port < 1 || port > 65535) {
    throw Object.assign(new Error('Port must be between 1 and 65535'), { status: 400 });
  }

  return { host, username, name, port, password };
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
    `SELECT id, name, host, port, username, password
       FROM hosts
      WHERE user_id = ?
      ORDER BY created_at ASC`,
    [user.id]
  );
  json(res, 200, { hosts });
}

async function createHost(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  const host = { id: randomUUID(), ...hostPayload(await readJson(req)) };
  await pool.execute(
    `INSERT INTO hosts (id, user_id, name, host, port, username, password)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [host.id, user.id, host.name, host.host, host.port, host.username, host.password]
  );
  json(res, 201, { host });
}

async function deleteHost(req, res, id) {
  const user = await requireUser(req, res);
  if (!user) return;

  await pool.execute('DELETE FROM hosts WHERE id = ? AND user_id = ?', [id, user.id]);
  json(res, 200, { ok: true });
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
    await destroySession(req);
    return json(res, 200, { ok: true }, { 'Set-Cookie': expiredSessionCookieHeader(req) });
  }
  if (req.method === 'PUT' && url.pathname === '/api/auth/password') return changePassword(req, res);
  if (req.method === 'GET' && url.pathname === '/api/hosts') return listHosts(req, res);
  if (req.method === 'POST' && url.pathname === '/api/hosts') return createHost(req, res);
  if (req.method === 'GET' && url.pathname === '/api/admin/users') return listUsers(req, res);

  const hostId = url.pathname.match(/^\/api\/hosts\/([^/]+)$/);
  if (req.method === 'DELETE' && hostId) {
    return deleteHost(req, res, decodeURIComponent(hostId[1]));
  }
  const approvalId = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/approval$/);
  if (req.method === 'PUT' && approvalId) {
    return reviewUser(req, res, decodeURIComponent(approvalId[1]));
  }

  return json(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    if (!error.status || error.status >= 500) console.error(error);
    json(res, error.status || 500, {
      error: error.status ? error.message : 'Internal server error',
    });
  });
});

attachSshWebSocket(server);

server.listen(port, '127.0.0.1', () => {
  console.log(`Ant Tech Async API listening on http://127.0.0.1:${port}`);
});
