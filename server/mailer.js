const nodemailer = require('nodemailer');

/**
 * Outgoing mail with a primary and an optional fallback SMTP account.
 *
 * The primary is the university's cPanel mailbox (no per-message cost). The
 * fallback is a transactional provider with a free quota, used only when the
 * primary is unavailable or rate limited. A permanent rejection (5xx, such as an
 * unknown recipient) is not retried elsewhere, so it does not spend the quota.
 *
 * Kept free of request handling so it can be tested with fake senders.
 * Design: docs/EMAIL_NOTIFICATIONS_DESIGN.md.
 */

const TRANSIENT_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNREFUSED', 'EDNS']);

function isTransientError(error) {
  const code = Number(error?.responseCode);
  if (code >= 400 && code < 500) return true;
  return TRANSIENT_CODES.has(error?.code);
}

function smtpSenderFromEnv(prefix, env) {
  const host = env[`${prefix}_HOST`];
  if (!host) return null;
  const port = Number(env[`${prefix}_PORT`] || 465);
  const user = env[`${prefix}_USER`];
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: user ? { user, pass: env[`${prefix}_PASS`] || '' } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    name: prefix.toLowerCase(),
    send: (message) => transport.sendMail(message),
  };
}

function createMailer({ senders = [], from }) {
  return {
    async send(message) {
      if (senders.length === 0) {
        throw Object.assign(new Error('Email delivery is not configured'), { status: 503 });
      }
      let lastError = null;
      const failures = [];
      for (const sender of senders) {
        try {
          const info = await sender.send({ from, ...message });
          // Log why an earlier sender was skipped, without addresses or secrets.
          if (failures.length > 0) {
            console.warn('mail-fallback-used', { provider: sender.name, previous: failures });
          }
          return { provider: sender.name, messageId: info?.messageId || null };
        } catch (error) {
          lastError = error;
          failures.push({ provider: sender.name, code: error.code || null, responseCode: error.responseCode || null });
          if (!isTransientError(error)) break;
        }
      }
      throw lastError;
    },
  };
}

function mailerFromEnv(env = process.env) {
  const senders = [
    smtpSenderFromEnv('SMTP_PRIMARY', env),
    smtpSenderFromEnv('SMTP_FALLBACK', env),
  ].filter(Boolean);
  return createMailer({ senders, from: env.MAIL_FROM || env.SMTP_PRIMARY_USER || undefined });
}

module.exports = {
  createMailer,
  isTransientError,
  mailerFromEnv,
};
