
const session = require('express-session');

class MySQLSessionStore extends session.Store {
  constructor(pool) {
    super();
    this.pool = pool;
  }

  async initialize({ serverless = false } = {}) {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id VARCHAR(128) NOT NULL,
        expires INT UNSIGNED NOT NULL,
        data MEDIUMTEXT NOT NULL,
        PRIMARY KEY (session_id),
        KEY idx_sessions_expires (expires)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    if (serverless) {
      await this.pool.execute(
        'DELETE FROM sessions WHERE expires <= ?',
        [Math.floor(Date.now() / 1000)]
      );
      return;
    }

    this.cleanupTimer = setInterval(() => {
      this.pool.execute(
        'DELETE FROM sessions WHERE expires <= ?',
        [Math.floor(Date.now() / 1000)]
      ).catch((error) =>
        console.error('Session cleanup failed:', error.message)
      );
    }, 15 * 60 * 1000);

    this.cleanupTimer.unref();
  }

  get(sessionId, callback) {
    this.pool.execute(
      'SELECT data, expires FROM sessions WHERE session_id = ? LIMIT 1',
      [sessionId]
    ).then(async ([rows]) => {
      if (rows.length === 0) return callback(null, null);

      if (rows[0].expires <= Math.floor(Date.now() / 1000)) {
        await this.pool.execute(
          'DELETE FROM sessions WHERE session_id = ?',
          [sessionId]
        );
        return callback(null, null);
      }

      try {
        callback(null, JSON.parse(rows[0].data));
      } catch (error) {
        callback(error);
      }
    }).catch(callback);
  }

  set(sessionId, sessionData, callback = () => {}) {
    const expires = sessionData.cookie?.expires
      ? Math.floor(new Date(sessionData.cookie.expires).getTime() / 1000)
      : Math.floor(Date.now() / 1000) + 60 * 60 * 8;

    this.pool.execute(
      `INSERT INTO sessions (session_id, expires, data)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE expires = VALUES(expires), data = VALUES(data)`,
      [sessionId, expires, JSON.stringify(sessionData)]
    ).then(() => callback(null)).catch(callback);
  }

  touch(sessionId, sessionData, callback = () => {}) {
    const expires = sessionData.cookie?.expires
      ? Math.floor(new Date(sessionData.cookie.expires).getTime() / 1000)
      : Math.floor(Date.now() / 1000) + 60 * 60 * 8;

    this.pool.execute(
      'UPDATE sessions SET expires = ? WHERE session_id = ?',
      [expires, sessionId]
    ).then(() => callback(null)).catch(callback);
  }

  destroy(sessionId, callback = () => {}) {
    this.pool.execute(
      'DELETE FROM sessions WHERE session_id = ?',
      [sessionId]
    ).then(() => callback(null)).catch(callback);
  }
}

module.exports = { MySQLSessionStore };
