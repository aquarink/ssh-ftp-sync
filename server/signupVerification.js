const { createHash, randomBytes, randomUUID } = require('crypto');

/**
 * Signup email verification: a single-use link proves the address belongs to
 * the person who registered. Design: docs/EMAIL_NOTIFICATIONS_DESIGN.md.
 *
 * - Tokens are random, stored only as SHA-256, valid for 24 hours, single use.
 * - Issuing a new token invalidates the open ones for that user.
 * - resend answers the same way for known and unknown addresses, so it cannot
 *   be used to find out which emails have accounts.
 */

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_LIMIT_PER_EMAIL = 3;
const RESEND_LIMIT_PER_IP = 10;
const RESEND_WINDOW_MS = 60 * 60 * 1000;
const GENERIC_RESENT = 'If that address has an account waiting for verification, we have sent a new link.';
const INVALID_LINK = 'This verification link is invalid or has expired. Request a new one.';

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function createRateLimiter({ limit, windowMs, now = () => Date.now() }) {
  const hits = new Map();
  return {
    // Records one attempt and reports whether it is over the limit.
    hit(key) {
      const current = now();
      const entries = (hits.get(key) || []).filter((at) => current - at < windowMs);
      entries.push(current);
      hits.set(key, entries);
      return entries.length > limit;
    },
  };
}

function verificationMessage(link) {
  return {
    subject: 'Verify your email for Ant Tech Async',
    text: [
      'Open this link to verify your email address. It is valid for 24 hours.',
      '',
      link,
      '',
      'After verification an administrator reviews the account before you can sign in.',
      'If you did not create an account, you can ignore this message.',
    ].join('\n'),
    html: [
      '<p>Open this link to verify your email address. It is valid for 24 hours.</p>',
      `<p><a href="${link}">Verify my email</a></p>`,
      '<p>After verification an administrator reviews the account before you can sign in.<br>',
      'If you did not create an account, you can ignore this message.</p>',
    ].join(''),
  };
}

function createSignupVerification({
  store,
  mailer,
  now = () => new Date(),
  rateLimiter = createRateLimiter({ limit: RESEND_LIMIT_PER_EMAIL, windowMs: RESEND_WINDOW_MS, now: () => now().getTime() }),
  ipRateLimiter = createRateLimiter({ limit: RESEND_LIMIT_PER_IP, windowMs: RESEND_WINDOW_MS, now: () => now().getTime() }),
}) {
  // Creates a token, invalidates older open ones, and mails the link.
  // `originForLink` is the public origin of the request (see deviceAuth.publicOrigin).
  async function issueAndSend(user, originForLink) {
    const token = randomBytes(32).toString('base64url');
    const at = now();
    await store.invalidateOpenTokens(user.id, at);
    await store.insertToken({
      id: randomUUID(),
      user_id: user.id,
      token_hash: hashToken(token),
      expires_at: new Date(at.getTime() + TOKEN_TTL_MS),
    });
    const link = `${originForLink}/verify?token=${token}`;
    return mailer.send({ template: 'signup_verification', to: user.email, ...verificationMessage(link) });
  }

  // Single use: the open token is flipped to used only once, so two concurrent
  // clicks cannot both verify.
  async function consume(token) {
    if (typeof token !== 'string' || token.length < 20) throw httpError(INVALID_LINK, 400);
    const row = await store.findTokenByHash(hashToken(token));
    const at = now();
    if (!row || row.used_at || new Date(row.expires_at) <= at) throw httpError(INVALID_LINK, 400);
    if (!(await store.markTokenUsed(row.id, at))) throw httpError(INVALID_LINK, 400);
    await store.markVerified(row.user_id, at);
    return { userId: row.user_id };
  }

  // Same answer for every address; sends only when there is a pending account.
  async function resend({ email, ip, originForLink }) {
    if (rateLimiter.hit(`email:${email}`) || ipRateLimiter.hit(`ip:${ip}`)) {
      throw httpError('Too many requests. Wait a while before requesting another link.', 429);
    }
    const user = await store.findUserByEmail(email);
    if (user && !user.email_verified_at && user.approval_status !== 'rejected') {
      // A delivery failure must look the same as no account, so it is logged, not returned.
      await issueAndSend(user, originForLink).catch((error) => {
        console.error('signup-verification-resend-failed', { status: error.status || null, code: error.code || null });
      });
    }
    return { ok: true, message: GENERIC_RESENT };
  }

  return { consume, issueAndSend, resend };
}

function createMysqlVerificationStore(pool) {
  return {
    async insertToken(row) {
      await pool.execute(
        'INSERT INTO email_verification_tokens (id, user_id, purpose, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)',
        [row.id, row.user_id, 'signup', row.token_hash, row.expires_at]
      );
    },
    async invalidateOpenTokens(userId, at) {
      await pool.execute(
        "UPDATE email_verification_tokens SET used_at = ? WHERE user_id = ? AND purpose = 'signup' AND used_at IS NULL",
        [at, userId]
      );
    },
    async findTokenByHash(hash) {
      const [rows] = await pool.execute(
        'SELECT id, user_id, used_at, expires_at FROM email_verification_tokens WHERE token_hash = ? LIMIT 1',
        [hash]
      );
      return rows[0] || null;
    },
    async markTokenUsed(id, at) {
      const [result] = await pool.execute(
        'UPDATE email_verification_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL',
        [at, id]
      );
      return result.affectedRows === 1;
    },
    async markVerified(userId, at) {
      await pool.execute('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', [at, userId]);
    },
    async findUserByEmail(email) {
      const [rows] = await pool.execute(
        'SELECT id, email, email_verified_at, approval_status FROM users WHERE email = ? LIMIT 1',
        [email]
      );
      return rows[0] || null;
    },
  };
}

function createMemoryVerificationStore({ users = [] } = {}) {
  const tokens = new Map();
  return {
    tokens,
    users,
    async insertToken(row) {
      tokens.set(row.id, { ...row, used_at: null, purpose: 'signup' });
    },
    async invalidateOpenTokens(userId, at) {
      for (const row of tokens.values()) {
        if (row.user_id === userId && !row.used_at) row.used_at = at;
      }
    },
    async findTokenByHash(hash) {
      const row = [...tokens.values()].find((t) => t.token_hash === hash);
      return row ? { ...row } : null;
    },
    async markTokenUsed(id, at) {
      const row = tokens.get(id);
      if (!row || row.used_at) return false;
      row.used_at = at;
      return true;
    },
    async markVerified(userId, at) {
      const user = users.find((u) => u.id === userId);
      if (user && !user.email_verified_at) user.email_verified_at = at;
    },
    async findUserByEmail(email) {
      const user = users.find((u) => u.email === email);
      return user ? { ...user } : null;
    },
  };
}

module.exports = {
  GENERIC_RESENT,
  INVALID_LINK,
  createMemoryVerificationStore,
  createMysqlVerificationStore,
  createRateLimiter,
  createSignupVerification,
  hashToken,
};
