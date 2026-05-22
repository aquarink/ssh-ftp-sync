const mysql = require('mysql2/promise');
const { loadEnv } = require('./env');

loadEnv();

const required = ['MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} is required`);
}

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 3306),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'Z',
});

module.exports = { pool };
