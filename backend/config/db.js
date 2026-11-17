const mysql = require('mysql2/promise');

const host = process.env.DB_HOST || 'localhost';
const useSsl = process.env.DB_SSL === 'true' || (
  process.env.NODE_ENV === 'production' &&
  !['localhost', '127.0.0.1', '::1'].includes(host.toLowerCase())
);

const pool = mysql.createPool({
  host,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'pune_seva',
  ...(useSsl ? { ssl: { rejectUnauthorized: true } } : {}),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
});

async function checkDatabaseConnection() {
  const connection = await pool.getConnection();
  try {
    await connection.query('SELECT 1');
  } finally {
    connection.release();
  }
}

module.exports = { pool, checkDatabaseConnection };
