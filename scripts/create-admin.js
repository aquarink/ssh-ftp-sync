const { randomUUID } = require('crypto');
const { pool } = require('../server/db');
const { hashPassword } = require('../server/auth');

async function createAdmin() {
  const [, , username, password, emailArg] = process.argv;
  if (!username || !password) {
    throw new Error('Usage: node scripts/create-admin.js <username> <password> [email]');
  }
  if (password.length < 16) {
    throw new Error('Administrator password must be at least 16 characters');
  }

  const email = emailArg || `${username}@local.ant-tech-async`;
  const [result] = await pool.execute(
    `INSERT INTO users (id, username, email, password_hash, role, approval_status)
     VALUES (?, ?, ?, ?, 'admin', 'approved')
     ON DUPLICATE KEY UPDATE
       username = VALUES(username),
       password_hash = VALUES(password_hash),
       role = 'admin',
       approval_status = 'approved'`,
    [randomUUID(), username.toLowerCase(), email.toLowerCase(), await hashPassword(password)]
  );

  console.log(result.affectedRows === 1 ? 'Administrator created.' : 'Administrator updated.');
}

createAdmin()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
