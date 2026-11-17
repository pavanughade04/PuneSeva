const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

test('production startup rejects a placeholder session secret before database access', () => {
  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SESSION_SECRET: 'your_placeholder_secret_with_more_than_32_characters'
    }
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Set SESSION_SECRET to a random value/);
});

test('production startup requires a configured private admin login path', () => {
  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SESSION_SECRET: 'a-valid-session-secret-that-is-long-enough',
      ADMIN_LOGIN_PATH: ''
    }
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Set ADMIN_LOGIN_PATH to a private absolute path/);
});
