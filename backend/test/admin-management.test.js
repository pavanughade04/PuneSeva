const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const express = require('express');
const session = require('express-session');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createAdminRouter } = require('../routes/admin');

const schema = {
  users: new Set(['account_status', 'phone']),
  providers: new Set(['user_id', 'business_name', 'approval_status', 'experience_years', 'service_area', 'description']),
  services: new Set(['id', 'image']),
  experienceColumn: 'experience_years',
  areaColumn: 'service_area',
  descriptionColumn: 'description'
};

async function startServer(configure) {
  const app = express();
  app.use(express.json());
  configure(app);
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(500).json({ error: 'Request failed.' });
  });
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

function adminApp(pool, currentSchema = schema) {
  return (app) => {
    app.use('/api/admin', (req, res, next) => {
      req.user = { id: 8, role: 'admin' };
      next();
    }, requireRole('admin'), createAdminRouter({ pool, schema: currentSchema }));
  };
}

function transactionPool({ rowsByQuery = [], bookingStatus = 'pending' } = {}) {
  const calls = [];
  const state = { committed: false, rolledBack: false, released: false };
  const connection = {
    beginTransaction: async () => {},
    execute: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes('SELECT p.user_id')) return [[{ user_id: 27 }], []];
      if (sql.includes('SELECT id, status FROM bookings')) return [[{ id: 44, status: bookingStatus }], []];
      if (sql.startsWith('SELECT id FROM reviews')) return [[{ id: 61 }], []];
      if (sql.startsWith('SELECT id FROM services')) return [[{ id: 33 }], []];
      if (sql.startsWith('INSERT INTO admin_audit_log')) return [{ insertId: 1, affectedRows: 1 }, []];
      if (sql.startsWith('UPDATE') || sql.startsWith('DELETE')) return [{ affectedRows: 1 }, []];
      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
    commit: async () => { state.committed = true; },
    rollback: async () => { state.rolledBack = true; },
    release: () => { state.released = true; }
  };
  return { calls, state, pool: { getConnection: async () => connection } };
}

test('admin provider rejection requires and records a reason transactionally', async (t) => {
  const fixture = transactionPool();
  const server = await startServer(adminApp(fixture.pool));
  t.after(() => server.close());

  let response = await fetch(`${server.baseUrl}/api/admin/providers/27/reject`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'no' })
  });
  assert.equal(response.status, 400);
  assert.equal(fixture.calls.length, 0);

  response = await fetch(`${server.baseUrl}/api/admin/providers/27/reject`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Application details are incomplete.' })
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.provider.approvalStatus, 'rejected');
  assert.equal(result.provider.reason, 'Application details are incomplete.');
  assert.equal(fixture.state.committed, true);
  assert.equal(fixture.state.released, true);
  const audit = fixture.calls.find((call) => call.sql.startsWith('INSERT INTO admin_audit_log'));
  assert.deepEqual(audit.values, [8, 'provider', 27, 'rejected', 'Application details are incomplete.']);
});

test('admin booking cancellation keeps Phase 6 transitions and records its reason', async (t) => {
  const fixture = transactionPool({ bookingStatus: 'accepted' });
  const server = await startServer(adminApp(fixture.pool));
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/admin/bookings/44/cancel`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Customer requested cancellation.' })
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.booking.status, 'cancelled');
  const update = fixture.calls.find((call) => call.sql.startsWith('UPDATE bookings'));
  assert.match(update.sql, /status IN \('pending', 'accepted', 'in_progress'\)/);
  assert.doesNotMatch(update.sql, /rejection_reason/);
  assert.deepEqual(fixture.calls.find((call) => call.sql.startsWith('INSERT INTO admin_audit_log')).values, [
    8, 'booking', 44, 'cancelled', 'Customer requested cancellation.'
  ]);
  assert.equal(fixture.state.committed, true);
});

test('admin cannot cancel a completed booking', async (t) => {
  const fixture = transactionPool({ bookingStatus: 'completed' });
  const server = await startServer(adminApp(fixture.pool));
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/admin/bookings/44/cancel`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Administrative request.' })
  });
  assert.equal(response.status, 409);
  assert.equal(fixture.calls.some((call) => call.sql.startsWith('UPDATE bookings')), false);
  assert.equal(fixture.calls.some((call) => call.sql.startsWith('INSERT INTO admin_audit_log')), false);
  assert.equal(fixture.state.committed, true);
});

test('admin message status update returns a confirmation and the updated message', async (t) => {
  const calls = [];
  const pool = {
    execute: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes('information_schema.tables')) return [[{ present: 1 }], []];
      if (sql.startsWith('UPDATE contact_messages')) return [{ affectedRows: 1 }, []];
      throw new Error(`Unexpected SQL in test: ${sql}`);
    }
  };
  const server = await startServer(adminApp(pool));
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/admin/messages/73/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'resolved' })
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(result, {
    message: 'Message status updated.',
    contactMessage: { id: 73, status: 'resolved' }
  });
  assert.deepEqual(calls[1].values, ['resolved', 73]);
});

test('admin service list paginates and supports installations without price_type', async (t) => {
  const calls = [];
  const pool = {
    execute: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes('COUNT(*)')) return [[{ total: 13 }], []];
      return [[{
        id: 33,
        serviceName: 'Cleaning',
        isAvailable: 1,
        approvalStatus: 'approved'
      }], []];
    }
  };
  const server = await startServer(adminApp(pool));
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/admin/services?status=all&category=Cleaning&page=2&limit=5`);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(result.pagination, {
    page: 2,
    limit: 5,
    total: 13,
    totalPages: 3,
    hasNextPage: true
  });
  assert.equal(result.services[0].isAvailable, true);
  assert.match(calls[1].sql, /'fixed' AS priceType/);
  assert.doesNotMatch(calls[1].sql, /s\.price_type/);
  assert.deepEqual(calls[1].values, ['Cleaning', 5, 5]);
});

test('unauthenticated and customer sessions cannot reach admin APIs', async (t) => {
  let databaseCalls = 0;
  const pool = {
    execute: async () => {
      databaseCalls += 1;
      return [[{
        id: 14,
        full_name: 'Customer',
        email: 'customer@example.com',
        role: 'customer'
      }], []];
    }
  };
  const server = await startServer((app) => {
    app.use(session({
      name: 'test.sid',
      secret: 'test-session-secret-that-is-long-enough',
      resave: false,
      saveUninitialized: false
    }));
    app.get('/test-login', (req, res) => {
      req.session.user = { id: 14 };
      res.json({ ok: true });
    });
    app.use('/api/admin', requireAuth(pool, schema), requireRole('admin'), createAdminRouter({ pool, schema }));
  });
  t.after(() => server.close());

  let response = await fetch(`${server.baseUrl}/api/admin/dashboard/stats`);
  assert.equal(response.status, 401);
  assert.equal(databaseCalls, 0);

  const login = await fetch(`${server.baseUrl}/test-login`);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  response = await fetch(`${server.baseUrl}/api/admin/dashboard/stats`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 403);
  assert.equal(databaseCalls, 1);
});

test('provider sessions cannot reach admin APIs', async (t) => {
  let databaseCalls = 0;
  const pool = {
    execute: async () => {
      databaseCalls += 1;
      return [[{
        id: 27,
        full_name: 'Provider',
        email: 'provider@example.com',
        role: 'provider'
      }], []];
    }
  };
  const server = await startServer((app) => {
    app.use(session({
      name: 'test.sid',
      secret: 'test-session-secret-that-is-long-enough',
      resave: false,
      saveUninitialized: false
    }));
    app.get('/test-login', (req, res) => {
      req.session.user = { id: 27 };
      res.json({ ok: true });
    });
    app.use('/api/admin', requireAuth(pool, schema), requireRole('admin'), createAdminRouter({ pool, schema }));
  });
  t.after(() => server.close());

  const login = await fetch(`${server.baseUrl}/test-login`);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const response = await fetch(`${server.baseUrl}/api/admin/dashboard/stats`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 403);
  assert.equal(databaseCalls, 1);
});
