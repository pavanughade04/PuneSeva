
require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
  override: false
});

const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

const migrationName = 'postgres_phase8_service_disputes.sql';

async function migrate() {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    const migrationPath = path.join(
      __dirname,
      '..',
      '..',
      'database',
      migrationName
    );

    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }

    const migrationSql = fs.readFileSync(migrationPath, 'utf8');

    await client.query('BEGIN');
    transactionStarted = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        migration_name varchar(255) PRIMARY KEY,
        applied_at timestamp without time zone
          NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const existing = await client.query(
      `SELECT migration_name
       FROM public.schema_migrations
       WHERE migration_name = $1`,
      [migrationName]
    );

    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      console.log(`Already applied: ${migrationName}`);
      return;
    }

    await client.query(migrationSql);

    await client.query(
      `INSERT INTO public.schema_migrations (migration_name)
       VALUES ($1)`,
      [migrationName]
    );

    await client.query('COMMIT');
    transactionStarted = false;

    console.log(`Migration applied: ${migrationName}`);
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK');
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error('Migration failed:', error.message);
  process.exitCode = 1;
});
