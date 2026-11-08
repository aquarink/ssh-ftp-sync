// Read-only summary of outgoing mail for today (UTC) and the latest failures.
// Usage: node scripts/mail-status.js [limit]
// Reads the same .env as the API. Prints codes and recipients only, never message bodies or credentials.
const { loadEnv } = require('../server/env');
loadEnv();
const { pool } = require('../server/db');
const { startOfUtcDay } = require('../server/mailOutbox');

async function main() {
  const limit = Math.min(Number(process.argv[2]) || 20, 200);
  const cap = Number(process.env.EMAIL_DAILY_CAP) || 150;
  const since = startOfUtcDay(new Date());

  const [totals] = await pool.execute(
    `SELECT status, provider, COUNT(*) AS total
       FROM email_outbox
      WHERE created_at >= ?
      GROUP BY status, provider
      ORDER BY status, provider`,
    [since]
  );
  const sent = totals.filter((row) => row.status === 'sent').reduce((sum, row) => sum + Number(row.total), 0);

  console.log(`Today (UTC, from ${since.toISOString()}):`);
  if (totals.length === 0) console.log('  no messages recorded');
  for (const row of totals) {
    console.log(`  ${row.status.padEnd(9)} ${String(row.provider || '-').padEnd(10)} ${row.total}`);
  }
  console.log(`  sent ${sent} of daily cap ${cap} (${Math.max(0, cap - sent)} left)`);

  const [failures] = await pool.execute(
    `SELECT created_at, recipient, template, status, provider, last_error
       FROM email_outbox
      WHERE status <> 'sent'
      ORDER BY created_at DESC
      LIMIT ${limit}`
  );
  console.log(`\nLatest ${failures.length} failed or deferred:`);
  for (const row of failures) {
    console.log(`  ${new Date(row.created_at).toISOString()}  ${row.status.padEnd(8)} ${row.template.padEnd(20)} ${row.recipient}  ${row.last_error || ''}`);
  }
}

// The pool keeps the process alive, so exit explicitly once the report is printed.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('mail-status failed:', error.message);
    process.exit(1);
  });
