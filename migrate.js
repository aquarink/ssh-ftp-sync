const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { loadEnv } = require('./server/env');

loadEnv();

async function migrate() {
  const migrationsPath = path.join(__dirname, 'db', 'migrations');
  const required = ['MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'];

  for (const key of required) {
    if (!process.env[key]) throw new Error(`${key} is required`);
  }

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    multipleStatements: true,
  });

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      )
    `);

    const [applied] = await connection.query('SELECT name FROM schema_migrations');
    const appliedNames = new Set(applied.map((migration) => migration.name));
    const migrations = fs.readdirSync(migrationsPath)
      .filter((file) => file.endsWith('.sql') || file.endsWith('.js'))
      .sort();

    for (const migration of migrations) {
      if (appliedNames.has(migration)) continue;

      await connection.beginTransaction();
      try {
        if (migration.endsWith('.sql')) {
          const sql = fs.readFileSync(path.join(migrationsPath, migration), 'utf8');
          await connection.query(sql);
        } else if (migration.endsWith('.js')) {
          const migrationModule = require(path.join(migrationsPath, migration));
          if (typeof migrationModule.up !== 'function') {
            throw new Error(`Migration ${migration} does not export an 'up' function`);
          }
          await migrationModule.up(connection);
        }
        await connection.query('INSERT INTO schema_migrations (name) VALUES (?)', [migration]);
        await connection.commit();
        console.log(`Applied ${migration}.`);
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }

    console.log(`MySQL migrations are current for ${process.env.MYSQL_DATABASE}.`);
  } finally {
    await connection.end();
  }
}

migrate().catch((error) => {
  console.error('MySQL migration failed:', error.message);
  process.exitCode = 1;
});
