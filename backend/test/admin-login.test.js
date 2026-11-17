const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const bcrypt = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const { createAdminLoginRouter, createAuthRouter } = require('../routes/auth');

const privateAdminLoginPath = '/private-admin-login-test';

async function startAuthServer(pool) {
  const app = express();
  app.use(express.json());
  app.use(session({
    name: 'test.sid',
    secret: 'test-session-secret-that-is-long-enough',
    resave: false,
    saveUninitialized: false
  }));
  app.use('/api/auth', createAuthRouter({
    pool,
    schema: { users: new Set(['account_status']), providers: new Set() },
    sessionCookieName: 'test.sid'
  }));
  app.use(privateAdminLoginPath, createAdminLoginRouter({
    pool,
    schema: { users: new Set(['account_status']) }
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

test('admin login endpoint accepts admin credentials without disclosing a dashboard URL', async (t) => {
  const passwordHash = await bcrypt.hash('AdminPassword123!', 4);
  let executed;
  const pool = {
    execute: async (sql, values) => {
      executed = { sql, values };
      return [[{
        id: 8,
        full_name: 'Pune Seva Admin',
        email: 'admin@example.com',
        role: 'admin',
        password_hash: passwordHash
      }], []];
    }
  };
  const server = await startAuthServer(pool);
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}${privateAdminLoginPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'AdminPassword123!' })
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.user.role, 'admin');
  assert.equal(Object.hasOwn(result, 'redirectUrl'), false);
  assert.match(executed.sql, /AND role IN \(\?\)/);
  assert.deepEqual(executed.values, ['admin@example.com', 'admin']);
  assert.match(response.headers.get('set-cookie'), /test\.sid=/);

  const publicEndpoint = await fetch(`${server.baseUrl}/api/auth/admin-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'AdminPassword123!' })
  });
  assert.equal(publicEndpoint.status, 404);
});

test('admin login endpoint rejects non-admin accounts without starting a session', async (t) => {
  let executed;
  const pool = {
    execute: async (sql, values) => {
      executed = { sql, values };
      return [[], []];
    }
  };
  const server = await startAuthServer(pool);
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}${privateAdminLoginPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'customer@example.com', password: 'CustomerPassword123!' })
  });
  const result = await response.json();

  assert.equal(response.status, 401);
  assert.equal(result.error, 'Email or password is incorrect.');
  assert.match(executed.sql, /AND role IN \(\?\)/);
  assert.deepEqual(executed.values, ['customer@example.com', 'admin']);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('regular login continues to support customer accounts', async (t) => {
  const passwordHash = await bcrypt.hash('CustomerPassword123!', 4);
  let executed;
  const pool = {
    execute: async (sql, values) => {
      executed = { sql, values };
      return [[{
        id: 19,
        full_name: 'Pune Seva Customer',
        email: 'customer@example.com',
        role: 'customer',
        password_hash: passwordHash
      }], []];
    }
  };
  const server = await startAuthServer(pool);
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'customer@example.com', password: 'CustomerPassword123!' })
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.user.role, 'customer');
  assert.equal(result.redirectUrl, '/customer-dashboard.html');
  assert.match(executed.sql, /AND role IN \(\?, \?\)/);
  assert.deepEqual(executed.values, ['customer@example.com', 'customer', 'provider']);
});

test('regular login does not authenticate admin accounts or return an admin URL', async (t) => {
  let executed;
  const pool = {
    execute: async (sql, values) => {
      executed = { sql, values };
      return [[], []];
    }
  };
  const server = await startAuthServer(pool);
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'AdminPassword123!' })
  });
  const result = await response.json();

  assert.equal(response.status, 401);
  assert.equal(result.error, 'Email or password is incorrect.');
  assert.doesNotMatch(JSON.stringify(result), /admin-dashboard|admin-login/);
  assert.deepEqual(executed.values, ['admin@example.com', 'customer', 'provider']);
});
