const {
  createHash,
  randomBytes,
  randomUUID,
  scrypt: scryptCallback,
  timingSafeEqual,
} = require('crypto');
const { promisify } = require('util');
const { pool } = require('./db');

const scrypt = promisify(scryptCallback);
const sessionCookie = 'ats_session';
const sessionDays = Number(process.env.SESSION_DAYS || 30);

function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function readCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const separator = cookie.indexOf('=');
        return [
          decodeURIComponent(cookie.slice(0, separator)),
          decodeURIComponent(cookie.slice(separator + 1)),
        ];
      })
      .filter(([key]) => key)
  );
}

function sessionToken(req) {
  return readCookies(req.headers.cookie)[sessionCookie];
}

function shouldUseSecureCookie(req) {
  return req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
}

function sessionCookieHeader(token, req) {
  const secure = shouldUseSecureCookie(req) ? '; Secure' : '';
  return `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionDays * 86400}${secure}`;
}

function expiredSessionCookieHeader(req) {
  const secure = shouldUseSecureCookie(req) ? '; Secure' : '';
  return `${sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${Buffer.from(derived).toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  const [algorithm, salt, hash] = storedHash.split(':');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;

  const expected = Buffer.from(hash, 'hex');
  const derived = Buffer.from(await scrypt(password, salt, expected.length));
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

async function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + sessionDays * 86400 * 1000);

  await pool.execute(
    'INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [randomUUID(), userId, tokenHash, expiresAt]
  );

  return token;
}

async function destroySession(req) {
  const token = sessionToken(req);
  if (!token) return;
  await pool.execute('DELETE FROM sessions WHERE token_hash = ?', [hashSessionToken(token)]);
}

async function getSessionUser(req) {
  const token = sessionToken(req);
  if (!token) return null;

  const [rows] = await pool.execute(
    `SELECT users.id, users.email, users.username, users.role, users.approval_status
       FROM sessions
       JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
        AND sessions.expires_at > UTC_TIMESTAMP()
      LIMIT 1`,
    [hashSessionToken(token)]
  );

  return rows[0] || null;
}

module.exports = {
  createSession,
  destroySession,
  expiredSessionCookieHeader,
  getSessionUser,
  hashPassword,
  sessionCookieHeader,
  verifyPassword,
};
