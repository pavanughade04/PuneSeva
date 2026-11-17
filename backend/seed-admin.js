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
  const fields = ['full_name', 'email', 'password_hash', 'role'];
  const values = [fullName, email, passwordHash, 'admin'];
  if (schema.users.has('account_status')) {
    fields.push('account_status');
    values.push('active');
  } else if (schema.users.has('is_active')) {
    fields.push('is_active');
    values.push(1);
  }

  const connection = await pool.getConnection();
  let lockAcquired = false;
  let transactionStarted = false;
  try {
    const [lockRows] = await connection.execute(
      'SELECT GET_LOCK(?, 10) AS acquired',
      ['pune_seva_first_admin']
    );
    lockAcquired = Number(lockRows[0].acquired) === 1;
    if (!lockAcquired) throw new Error('Could not acquire the first-admin setup lock. Try again.');

    await connection.beginTransaction();
    transactionStarted = true;
    const [existingAdmins] = await connection.execute(
      "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
    );
    if (existingAdmins.length > 0) {
      throw new Error('An admin account already exists. The first-admin seed script will not replace it.');
    }

    await connection.execute(
      `INSERT INTO users (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
      values
    );
    await connection.commit();
    transactionStarted = false;
    console.log(`First admin account created for ${email}.`);
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally {
    try {
      if (lockAcquired) {
        await connection.execute('SELECT RELEASE_LOCK(?)', ['pune_seva_first_admin']);
      }
    } finally {
      connection.release();
    }
  }
}

seedFirstAdmin()
  .catch((error) => {
    console.error('Admin seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
