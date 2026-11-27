
const { Pool } = require('pg');

const host = process.env.DB_HOST || 'localhost';

const useSsl =
  process.env.DB_SSL === 'true' ||
  (
    process.env.NODE_ENV === 'production' &&
    !['localhost', '127.0.0.1', '::1'].includes(host.toLowerCase())
  );

const pool = new Pool({
  host,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'PuneSeva',

  ...(useSsl
    ? { ssl: { rejectUnauthorized: false } }
    : {}),

  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

async function checkDatabaseConnection() {
  const client = await pool.connect();

  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  checkDatabaseConnection
};
