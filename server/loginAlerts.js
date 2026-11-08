/**
 * Sign-in alerts. Design: docs/EMAIL_NOTIFICATIONS_DESIGN.md (stage 2).
 *
 * - Desktop sign-ins always send an alert (they are rare: one code per device).
 * - Web sign-ins send one only from an IP not seen for this user in the last 30
 *   days. The first sign-in of an account is recorded silently, so existing users
 *   are not mailed on the first login after this release.
 * - The user can switch alerts off (`users.login_alerts_enabled`). Security
 *   notices are not sent to anyone who turned them off.
 * - Alerts never block a sign-in: `onSignIn` swallows and logs its own failures.
 */

const KNOWN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function alertMessage({ at, ip, client, deviceLabel, origin }) {
  const app = client === 'desktop' ? `Desktop app (${deviceLabel || 'unnamed device'})` : 'Web browser';
  const reviewUrl = `${origin}/app/devices`;
  return {
    subject: 'New sign-in to your Ant Tech Async account',
    text: [
      'A sign-in just happened on your account.',
      '',
      `Time: ${at.toISOString()} (UTC)`,
      `From IP: ${ip}`,
      `App: ${app}`,
      '',
      'If this was you, no action is needed.',
      `If it was not you, sign in, open ${reviewUrl}, sign out that session, and change your password.`,
    ].join('\n'),
  };
}

function createLoginAlerts({ store, mailer, now = () => new Date(), logger = console }) {
  async function onSignIn({ userId, client, ip, deviceLabel = null, origin }) {
    try {
      if (!userId || !ip) return { alerted: false, reason: 'missing_context' };
      const at = now();
      const user = await store.findUser(userId);
      if (!user) return { alerted: false, reason: 'no_user' };

      const knownSince = new Date(at.getTime() - KNOWN_WINDOW_MS);
      const knownRecently = await store.isKnownIpSince(userId, ip, knownSince);
      const hasAnyIp = await store.hasAnyKnownIp(userId);
      await store.touchKnownIp(userId, ip, at);

      const shouldAlert = client === 'desktop' || (!knownRecently && hasAnyIp);
      if (!shouldAlert) return { alerted: false, reason: 'known_or_baseline' };
      if (!user.login_alerts_enabled) return { alerted: false, reason: 'disabled' };
      if (!user.email_verified_at) return { alerted: false, reason: 'unverified' };

      await mailer.send({
        template: 'login_alert',
        to: user.email,
        ...alertMessage({ at, ip, client, deviceLabel, origin }),
      });
      return { alerted: true };
    } catch (error) {
      logger.error('login-alert-failed', { status: error.status || null, reason: error.reason || null, message: error.message });
      return { alerted: false, reason: 'error' };
    }
  }

  return { onSignIn };
}

function createMysqlLoginAlertStore(pool) {
  return {
    async findUser(userId) {
      const [rows] = await pool.execute(
        'SELECT id, email, email_verified_at, login_alerts_enabled FROM users WHERE id = ? LIMIT 1',
        [userId]
      );
      const row = rows[0];
      return row ? { ...row, login_alerts_enabled: Boolean(row.login_alerts_enabled) } : null;
    },
    async isKnownIpSince(userId, ip, since) {
      const [rows] = await pool.execute(
        'SELECT 1 FROM user_known_ips WHERE user_id = ? AND ip = ? AND last_seen_at >= ? LIMIT 1',
        [userId, ip, since]
      );
      return rows.length > 0;
    },
    async hasAnyKnownIp(userId) {
      const [rows] = await pool.execute('SELECT 1 FROM user_known_ips WHERE user_id = ? LIMIT 1', [userId]);
      return rows.length > 0;
    },
    async touchKnownIp(userId, ip, at) {
      await pool.execute(
        `INSERT INTO user_known_ips (user_id, ip, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE last_seen_at = ?`,
        [userId, ip, at, at, at]
      );
    },
  };
}

function createMemoryLoginAlertStore({ users = [] } = {}) {
  const known = new Map();
  const key = (userId, ip) => `${userId}|${ip}`;
  return {
    known,
    async findUser(userId) {
      const user = users.find((u) => u.id === userId);
      return user ? { ...user } : null;
    },
    async isKnownIpSince(userId, ip, since) {
      const entry = known.get(key(userId, ip));
      return Boolean(entry && entry >= since);
    },
    async hasAnyKnownIp(userId) {
      return [...known.keys()].some((k) => k.startsWith(`${userId}|`));
    },
    async touchKnownIp(userId, ip, at) {
      known.set(key(userId, ip), at);
    },
  };
}

module.exports = {
  KNOWN_WINDOW_MS,
  createLoginAlerts,
  createMemoryLoginAlertStore,
  createMysqlLoginAlertStore,
};
