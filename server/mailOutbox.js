const { randomUUID } = require('crypto');

/**
 * Records every outgoing message and enforces a daily cap, in front of the mailer.
 *
 * The cap protects the free SMTP2GO quota (200 a day): once today's sent count
 * reaches the cap, further messages are recorded as `deferred` and not sent,
 * instead of silently failing at the provider. Recipients are kept for support;
 * error text is reduced to codes, never message bodies or credentials.
 * Design: docs/EMAIL_NOTIFICATIONS_DESIGN.md.
 */

const DEFAULT_DAILY_CAP = 150;

function startOfUtcDay(at) {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

function describeError(error) {
  const code = error?.responseCode || error?.code || error?.status || 'unknown';
  return String(code).slice(0, 255);
}

function createOutboxMailer({ mailer, store, dailyCap = DEFAULT_DAILY_CAP, now = () => new Date() }) {
  return {
    // `template` names the message for the outbox and is not sent to the provider.
    async send({ template = 'generic', to, ...message }) {
      const at = now();
      const id = randomUUID();
      const sentToday = await store.countSentSince(startOfUtcDay(at));
      if (sentToday >= dailyCap) {
        await store.record({ id, recipient: to, template, status: 'deferred', provider: null, last_error: 'daily cap reached' });
        throw Object.assign(new Error('Daily email limit reached. Try again tomorrow.'), { status: 503, reason: 'daily_cap' });
      }

      try {
        const result = await mailer.send({ to, ...message });
        await store.record({ id, recipient: to, template, status: 'sent', provider: result.provider, last_error: null });
        return result;
      } catch (error) {
        await store.record({ id, recipient: to, template, status: 'failed', provider: null, last_error: describeError(error) });
        throw error;
      }
    },
  };
}

function createMysqlOutboxStore(pool) {
  return {
    async record(row) {
      await pool.execute(
        'INSERT INTO email_outbox (id, recipient, template, status, provider, last_error) VALUES (?, ?, ?, ?, ?, ?)',
        [row.id, row.recipient, row.template, row.status, row.provider, row.last_error]
      );
    },
    async countSentSince(since) {
      const [rows] = await pool.execute(
        "SELECT COUNT(*) AS total FROM email_outbox WHERE status = 'sent' AND created_at >= ?",
        [since]
      );
      return Number(rows[0]?.total || 0);
    },
  };
}

function createMemoryOutboxStore() {
  const rows = [];
  return {
    rows,
    async record(row) {
      rows.push({ ...row, created_at: new Date() });
    },
    async countSentSince(since) {
      return rows.filter((row) => row.status === 'sent' && row.created_at >= since).length;
    },
  };
}

module.exports = {
  DEFAULT_DAILY_CAP,
  createMemoryOutboxStore,
  createMysqlOutboxStore,
  createOutboxMailer,
  startOfUtcDay,
};
