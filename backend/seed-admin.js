
require('dotenv').config();

const bcrypt = require('bcryptjs');
const { pool } = require('./config/db');
const { loadAuthSchema } = require('./services/auth-schema');

async function seedFirstAdmin() {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('The admin seed script is development-only. Set NODE_ENV=development to run it.');
  }

  const fullName = process.env.ADMIN_NAME?.trim();
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!fullName || fullName.length < 2 || fullName.length > 100) {
    throw new Error('Set ADMIN_NAME to a name between 2 and 100 characters.');
  }

  if (!email || email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Set ADMIN_EMAIL to a valid email address.');
  }

  if (!password || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Set ADMIN_PASSWORD to a password between 12 characters and 72 bytes.');
  }

  const schema = await loadAuthSchema(pool);
  const passwordHash = await bcrypt.hash(password, 12);

  const fields = [
    'full_name',
    'email',
    'password_hash',
    'role',
    'is_active'
  ];

  const values = [
    fullName,
    email,
    passwordHash,
    'admin',
    true
  ];

  const client = await pool.connect();
  let transactionStarted = false;
  let lockAcquired = false;

  try {
    const lockResult = await client.query(
      'SELECT pg_try_advisory_lock($1, $2) AS acquired',
      [20261124, 1]
    );

    lockAcquired = lockResult.rows[0].acquired;

    if (!lockAcquired) {
      throw new Error('Could not acquire the first-admin setup lock. Try again.');
    }

    await client.query('BEGIN');
    transactionStarted = true;

    const existingAdmins = await client.query(
      "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
    );

    if (existingAdmins.rows.length > 0) {
      throw new Error('An admin account already exists. The first-admin seed script will not replace it.');
    }

    const placeholders = values
      .map((_, index) => `$${index + 1}`)
      .join(', ');

    await client.query(
      `INSERT INTO users (${fields.join(', ')})
       VALUES (${placeholders})`,
      values
    );

    await client.query('COMMIT');
    transactionStarted = false;

    console.log(`First admin account created for ${email}.`);
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Admin seed rollback failed:', rollbackError.message);
      }
    }

    throw error;
  } finally {
    try {
      if (lockAcquired) {
        await client.query(
          'SELECT pg_advisory_unlock($1, $2)',
          [20261124, 1]
        );
      }
    } finally {
      client.release();
    }
  }
}

seedFirstAdmin()
  .catch((error) => {
    console.error('Admin seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
