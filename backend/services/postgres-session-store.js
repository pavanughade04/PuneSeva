
const session = require('express-session');

class PostgreSQLSessionStore extends session.Store {
  constructor(pool) {
    super();
    this.pool = pool;
    this.cleanupTimer = null;
  }

  async initialize({ serverless = false } = {}) {
    // PostgreSQL sessions table already exists.
    // Do not perform automatic schema changes during startup.

    if (serverless) {
      await this.pool.query(
        'DELETE FROM sessions WHERE expires <= $1',
        [Math.floor(Date.now() / 1000)]
      );
      return;
    }

    this.cleanupTimer = setInterval(() => {
      this.pool.query(
        'DELETE FROM sessions WHERE expires <= $1',
        [Math.floor(Date.now() / 1000)]
      ).catch((error) => {
        console.error('Session cleanup failed:', error.message);
      });
    }, 15 * 60 * 1000);

    this.cleanupTimer.unref();
  }

  get(sessionId, callback) {
    this.pool.query(
      `SELECT data, expires
       FROM sessions
       WHERE session_id = $1
       LIMIT 1`,
      [sessionId]
    ).then(async (result) => {
      if (result.rows.length === 0) {
        return callback(null, null);
      }

      const row = result.rows[0];

      if (Number(row.expires) <= Math.floor(Date.now() / 1000)) {
        await this.pool.query(
          'DELETE FROM sessions WHERE session_id = $1',
          [sessionId]
        );

        return callback(null, null);
      }

      try {
        callback(null, JSON.parse(row.data));
      } catch (error) {
        callback(error);
      }
    }).catch(callback);
  }

  set(sessionId, sessionData, callback = () => {}) {
    const expires = sessionData.cookie?.expires
      ? Math.floor(
          new Date(sessionData.cookie.expires).getTime() / 1000
        )
      : Math.floor(Date.now() / 1000) + 60 * 60 * 8;

    this.pool.query(
      `INSERT INTO sessions (session_id, expires, data)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id)
       DO UPDATE SET
         expires = EXCLUDED.expires,
         data = EXCLUDED.data`,
      [sessionId, expires, JSON.stringify(sessionData)]
    ).then(() => callback(null)).catch(callback);
  }

  touch(sessionId, sessionData, callback = () => {}) {
    const expires = sessionData.cookie?.expires
      ? Math.floor(
          new Date(sessionData.cookie.expires).getTime() / 1000
        )
      : Math.floor(Date.now() / 1000) + 60 * 60 * 8;

    this.pool.query(
      `UPDATE sessions
       SET expires = $1
       WHERE session_id = $2`,
      [expires, sessionId]
    ).then(() => callback(null)).catch(callback);
  }

  destroy(sessionId, callback = () => {}) {
    this.pool.query(
      'DELETE FROM sessions WHERE session_id = $1',
      [sessionId]
    ).then(() => callback(null)).catch(callback);
  }
}

module.exports = { PostgreSQLSessionStore };