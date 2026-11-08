const { createHash, randomBytes, randomInt, randomUUID } = require('crypto');
const { logAccessEvent } = require('./securityLog');
const { incrementMetric } = require('./securityMetrics');

/**
 * Device authorization for the desktop runtime (OAuth 2.0 device grant,
 * RFC 8628, adapted). Design: docs/DESKTOP_DEVICE_LOGIN_DESIGN.md.
 *
 * The desktop cannot complete the Turnstile-protected password login from a
 * file:// page, so it never tries: it asks for a short user code, the user
 * approves that code in the system browser on the real site (where login and
 * Turnstile work as usual), and the desktop's next poll receives an ordinary
 * session cookie, marked client='desktop'.
 *
 * Properties:
 * - deviceCode: 32 random bytes, stored hashed, single use, never logged
 * - userCode: 8 chars without vowels or look-alikes, unique among live rows,
 *   formatted XXXX-XXXX for humans
 * - lifetime 10 minutes; `start` and wrong-code attempts are rate limited;
 *   `poll` enforces a minimum interval
 * - only an approved account's session can approve, and only a `pending` row
 *   can move on, so a row is consumed exactly once
 */
const USER_CODE_ALPHABET = 'BCDFGHJKMNPQRSTVWXZ23456789';
const USER_CODE_LENGTH = 8;

const DEFAULTS = {
  ttlMs: 10 * 60_000,
  pollIntervalMs: 5_000,
  rateWindowMs: 10 * 60_000,
  startLimitPerIp: 10,
  pendingPerIp: 3,
  wrongCodeLimitPerUser: 5,
  deviceLabelMaxLength: 120,
  appVersionMaxLength: 40,
  sessionDays: Number(process.env.DESKTOP_SESSION_DAYS || process.env.SESSION_DAYS || 30),
};

function httpError(message, status, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

function hashDeviceCode(deviceCode) {
  return createHash('sha256').update(deviceCode).digest('hex');
}

function generateUserCode(pick = (max) => randomInt(max)) {
  let code = '';
  for (let index = 0; index < USER_CODE_LENGTH; index += 1) {
    code += USER_CODE_ALPHABET[pick(USER_CODE_ALPHABET.length)];
  }
  return code;
}

function formatUserCode(code) {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

// Accepts what a human types: lower case, dashes, spaces. Returns the stored
// form or null when it cannot be a code at all (so a typo is not an "attempt").
function normalizeUserCode(input) {
  const code = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== USER_CODE_LENGTH) return null;
  for (const char of code) {
    if (!USER_CODE_ALPHABET.includes(char)) return null;
  }
  return code;
}

function clientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim().slice(0, 64);
  }
  return String(req.socket?.remoteAddress || 'unknown').slice(0, 64);
}

// Where the browser half of the flow lives. In production the SPA and the API
// share the origin behind the edge proxy; in development the SPA is on :5173,
// so APP_PUBLIC_ORIGIN points there.
function publicOrigin(req, env = process.env) {
  if (env.APP_PUBLIC_ORIGIN) {
    try {
      return new URL(env.APP_PUBLIC_ORIGIN).origin;
    } catch {
      // fall through to the request
    }
  }
  const proto = req.headers?.['x-forwarded-proto'] === 'https' || env.NODE_ENV === 'production' ? 'https' : 'http';
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host || 'localhost';
  return `${proto}://${host}`;
}

function sameOrigin(req, origin) {
  const header = req.headers?.origin;
  if (!header) return true; // non-browser or same-origin GET; the cookie's SameSite=Lax already blocks cross-site POSTs
  return header === origin;
}

function trimTo(value, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, max) : null;
}

function publicDeviceAuthorization(row, now) {
  return {
    deviceLabel: row.device_label,
    appVersion: row.app_version,
    runtime: row.runtime,
    requesterIp: row.requester_ip,
    requestedAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    expiresIn: Math.max(0, Math.ceil((new Date(row.expires_at) - now) / 1000)),
  };
}

function createDeviceAuth({ store, createSession, now = () => new Date(), env = process.env, options = {} }) {
  const config = { ...DEFAULTS, ...options };
  const rateStore = new Map();

  function recentAttempts(key) {
    const current = now().getTime();
    const entries = (rateStore.get(key) || []).filter((timestamp) => current - timestamp < config.rateWindowMs);
    rateStore.set(key, entries);
    return entries;
  }

  function overLimit(key, limit) {
    const entries = recentAttempts(key);
    entries.push(now().getTime());
    return entries.length > limit;
  }

  function reject(reason, details = {}) {
    incrementMetric('deviceAuthRejected', 1);
    logAccessEvent('deviceAuthRejected', { reason, ...details });
  }

  function isExpired(row, at) {
    return new Date(row.expires_at) <= at;
  }

  async function expireRow(row) {
    if (await store.transition(row.id, row.status, { status: 'expired' })) {
      logAccessEvent('deviceAuthExpired', { id: row.id, userId: row.user_id, pollCount: row.poll_count });
    }
  }

  async function start(req, body = {}) {
    const ip = clientIp(req);
    const runtime = String(body.runtime || '').toLowerCase();
    if (runtime !== 'electron') {
      reject('runtime_not_allowed', { ip, runtime });
      throw httpError('Device authorization is only available to the desktop runtime', 400);
    }
    if (overLimit(`start:${ip}`, config.startLimitPerIp)) {
      reject('rate_limited', { ip, step: 'start' });
      throw httpError('Too many device authorization requests', 429);
    }

    // Keep at most N pending rows per IP: a desktop that restarts repeatedly
    // should not leave a trail of live codes behind.
    const pending = await store.listPendingByIp(ip);
    for (const stale of pending.slice(config.pendingPerIp - 1)) {
      await store.transition(stale.id, 'pending', { status: 'expired' });
    }

    const at = now();
    const deviceCode = randomBytes(32).toString('base64url');
    const row = {
      id: randomUUID(),
      device_code_hash: hashDeviceCode(deviceCode),
      user_code: null,
      runtime: 'electron',
      device_label: trimTo(body.deviceLabel, config.deviceLabelMaxLength),
      app_version: trimTo(body.appVersion, config.appVersionMaxLength),
      requester_ip: ip,
      expires_at: new Date(at.getTime() + config.ttlMs),
      created_at: at,
    };

    // user_code is unique among all rows; retry the (very unlikely) collision.
    for (let attempt = 0; ; attempt += 1) {
      row.user_code = generateUserCode();
      try {
        await store.insert(row);
        break;
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY' || attempt >= 4) throw error;
      }
    }

    incrementMetric('deviceAuthStarted', 1);
    logAccessEvent('deviceAuthStarted', { id: row.id, ip, deviceLabel: row.device_label, appVersion: row.app_version });

    const origin = publicOrigin(req, env);
    const formatted = formatUserCode(row.user_code);
    return {
      deviceCode,
      userCode: formatted,
      verificationUrl: `${origin}/device`,
      verificationUrlComplete: `${origin}/device?code=${formatted}`,
      expiresAt: row.expires_at.toISOString(),
      expiresIn: Math.ceil(config.ttlMs / 1000),
      interval: Math.ceil(config.pollIntervalMs / 1000),
    };
  }

  // Returns { status, body, user?, sessionToken? }; the route turns it into the
  // HTTP response (the session cookie header needs `req`, which stays there).
  async function poll(req, body = {}) {
    const deviceCode = typeof body.deviceCode === 'string' ? body.deviceCode : '';
    if (!deviceCode) throw httpError('deviceCode is required', 400);

    const row = await store.findByDeviceCodeHash(hashDeviceCode(deviceCode));
    if (!row) {
      reject('unknown_device_code', { ip: clientIp(req) });
      throw httpError('Unknown device code', 404);
    }

    const at = now();
    if (['pending', 'approved'].includes(row.status) && isExpired(row, at)) {
      await expireRow(row);
      row.status = 'expired';
    }

    if (row.last_polled_at && at - new Date(row.last_polled_at) < config.pollIntervalMs) {
      reject('slow_down', { id: row.id, pollCount: row.poll_count });
      return { status: 429, body: { status: 'slow_down', interval: Math.ceil(config.pollIntervalMs / 1000) } };
    }
    await store.recordPoll(row.id, at);

    if (row.status === 'pending') {
      return { status: 428, body: { status: 'authorization_pending', interval: Math.ceil(config.pollIntervalMs / 1000) } };
    }
    if (row.status === 'denied') {
      return { status: 403, body: { status: 'denied', error: 'The sign-in was denied in the browser' } };
    }
    if (row.status !== 'approved') {
      return { status: 410, body: { status: row.status, error: 'This device code is no longer valid' } };
    }

    const user = await store.findUser(row.user_id);
    if (!user || user.approval_status !== 'approved') {
      await store.transition(row.id, 'approved', { status: 'denied' });
      reject('user_not_approved', { id: row.id, userId: row.user_id });
      return { status: 403, body: { status: 'denied', error: 'This account cannot sign in' } };
    }

    // Single use: whoever flips approved → consumed gets the session.
    const consumed = await store.transition(row.id, 'approved', { status: 'consumed', consumed_at: at });
    if (!consumed) {
      reject('already_consumed', { id: row.id });
      return { status: 410, body: { status: 'consumed', error: 'This device code is no longer valid' } };
    }

    const sessionToken = await createSession(user.id, {
      client: 'desktop',
      deviceLabel: row.device_label,
      days: config.sessionDays,
      ip: clientIp(req),
      origin: publicOrigin(req, env),
    });
    logAccessEvent('deviceAuthConsumed', {
      id: row.id,
      userId: user.id,
      deviceLabel: row.device_label,
      requesterIp: row.requester_ip,
      approverIp: row.approver_ip,
      pollCount: row.poll_count + 1,
    });
    return { status: 200, body: { status: 'approved' }, user, sessionToken };
  }

  // The browser side. `user` is the approving session's user (already loaded
  // by the route). Looks the row up by user code and counts wrong codes.
  async function lookupForUser(req, user, input) {
    if (!user || user.approval_status !== 'approved') {
      throw httpError('This account cannot approve devices', 403);
    }
    const userCode = normalizeUserCode(input);
    if (!userCode) throw httpError('Enter the code shown in the desktop app', 400);

    // Only wrong codes count as guesses; a live code found on the first try
    // does not eat into the budget.
    const attempts = recentAttempts(`code:${user.id}`);
    if (attempts.length >= config.wrongCodeLimitPerUser) {
      reject('rate_limited', { userId: user.id, step: 'approve' });
      throw httpError('Too many attempts. Wait a few minutes and try again.', 429);
    }

    const row = await store.findByUserCode(userCode);
    const at = now();
    if (!row || row.status !== 'pending' || isExpired(row, at)) {
      if (row && row.status === 'pending') await expireRow(row);
      attempts.push(at.getTime());
      reject('unknown_user_code', { userId: user.id, found: Boolean(row), status: row?.status || null });
      throw httpError('That code is not waiting for approval. Check the desktop app for a current code.', 404);
    }
    return { row, at };
  }

  async function describe(req, user, input) {
    const { row, at } = await lookupForUser(req, user, input);
    return { userCode: formatUserCode(row.user_code), ...publicDeviceAuthorization(row, at) };
  }

  async function approve(req, user, body = {}) {
    const origin = publicOrigin(req, env);
    if (!sameOrigin(req, origin)) {
      reject('origin_mismatch', { userId: user?.id, origin: req.headers?.origin });
      throw httpError('Cross-site approval is not allowed', 403);
    }
    const { row, at } = await lookupForUser(req, user, body.userCode);
    const ip = clientIp(req);
    const moved = await store.transition(row.id, 'pending', {
      status: 'approved',
      user_id: user.id,
      approver_ip: ip,
      approved_at: at,
    });
    if (!moved) throw httpError('That code is not waiting for approval', 409);

    incrementMetric('deviceAuthApproved', 1);
    logAccessEvent('deviceAuthApproved', {
      id: row.id,
      userId: user.id,
      deviceLabel: row.device_label,
      requesterIp: row.requester_ip,
      approverIp: ip,
    });
    return { ok: true, deviceLabel: row.device_label };
  }

  async function deny(req, user, body = {}) {
    const origin = publicOrigin(req, env);
    if (!sameOrigin(req, origin)) {
      reject('origin_mismatch', { userId: user?.id, origin: req.headers?.origin });
      throw httpError('Cross-site denial is not allowed', 403);
    }
    const { row } = await lookupForUser(req, user, body.userCode);
    const moved = await store.transition(row.id, 'pending', { status: 'denied', user_id: user.id, approver_ip: clientIp(req) });
    if (!moved) throw httpError('That code is not waiting for approval', 409);
    logAccessEvent('deviceAuthDenied', { id: row.id, userId: user.id, deviceLabel: row.device_label, requesterIp: row.requester_ip });
    return { ok: true };
  }

  async function listSessions(user, currentTokenHash) {
    const rows = await store.listSessions(user.id);
    return rows.map((row) => ({
      id: row.id,
      client: row.client || 'web',
      deviceLabel: row.device_label || null,
      createdAt: new Date(row.created_at).toISOString(),
      lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
      expiresAt: new Date(row.expires_at).toISOString(),
      current: Boolean(currentTokenHash) && row.token_hash === currentTokenHash,
    }));
  }

  async function revokeSession(user, sessionId, currentTokenHash) {
    const rows = await store.listSessions(user.id);
    const target = rows.find((row) => row.id === sessionId);
    if (!target) throw httpError('Session not found', 404);
    if (currentTokenHash && target.token_hash === currentTokenHash) {
      throw httpError('Use sign out to end the current session', 400);
    }
    await store.deleteSession(user.id, sessionId);
    logAccessEvent('sessionRevoked', { userId: user.id, sessionId, client: target.client || 'web', deviceLabel: target.device_label || null });
    return { ok: true };
  }

  async function sweep() {
    await store.sweep(now());
  }

  return { approve, deny, describe, listSessions, poll, revokeSession, start, sweep, config };
}

module.exports = {
  DEFAULTS,
  USER_CODE_ALPHABET,
  USER_CODE_LENGTH,
  clientIp,
  createDeviceAuth,
  formatUserCode,
  generateUserCode,
  hashDeviceCode,
  normalizeUserCode,
  publicOrigin,
};
