
const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const express = require('express');
const { requireRole } = require('../middleware/auth');
const { createCustomerRouter } = require('../routes/customer');

const schema = { users: new Set(['is_active']) };

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

async function startServer(app) {
  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

function createDisputePool({
  booking = {
    id: 15,
    customer_id: 41,
    provider_id: 27,
    status: 'completed',
    disputeWindowOpen: true
  },
  duplicate = false,
  failHistory = false
} = {}) {
  const calls = [];

  const state = {
    began: false,
    committed: false,
    rolledBack: false,
    released: false
  };

  const connection = {
    query: async (sql, values = []) => {
      const normalized = normalizeSql(sql);
      calls.push({ sql: normalized, values });

      if (normalized === 'BEGIN') {
        state.began = true;
        return { rows: [], rowCount: null };
      }

      if (normalized === 'COMMIT') {
        state.committed = true;
        return { rows: [], rowCount: null };
      }

      if (normalized === 'ROLLBACK') {
        state.rolledBack = true;
        return { rows: [], rowCount: null };
      }

      if (normalized.includes('FROM bookings') && normalized.includes('FOR UPDATE')) {
        return {
          rows: booking ? [booking] : [],
          rowCount: booking ? 1 : 0
        };
      }

      if (normalized.includes('INSERT INTO service_disputes')) {
        if (duplicate) {
          const error = new Error('Duplicate dispute');
          error.code = '23505';
          error.constraint = 'service_disputes_booking_unique';
          throw error;
        }

        return {
          rows: [{
            id: 90,
            status: 'pending',
            createdAt: '2026-11-26T10:00:00'
          }],
          rowCount: 1
        };
      }

      if (normalized.includes('INSERT INTO dispute_status_history')) {
        if (failHistory) {
          throw new Error('History insert failed');
        }

        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected SQL: ${normalized}`);
    },

    release: () => {
      state.released = true;
    }
  };

  return {
    calls,
    state,
    pool: {
      connect: async () => connection
    }
  };
}

function customerApp(pool, userId = 41) {
  const app = express();

  app.use(express.json());

  app.use(
    '/api/customer',
    (req, res, next) => {
      req.user = { id: userId, role: 'customer' };
      next();
    },
    requireRole('customer'),
    createCustomerRouter({ pool, schema })
  );

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(500).json({ error: 'Request failed.' });
  });

  return app;
}

test('customer can create a dispute for their completed booking', async (t) => {
  const fixture = createDisputePool();
  const server = await startServer(customerApp(fixture.pool));

  t.after(() => server.close());

  const response = await fetch(
    `${server.baseUrl}/api/customer/bookings/15/dispute`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: 'Service quality issue',
        description: 'The service was not completed properly.'
      })
    }
  );

  assert.equal(response.status, 201);

  const result = await response.json();

  assert.equal(result.dispute.id, 90);
  assert.equal(result.dispute.status, 'pending');
  assert.equal(fixture.state.began, true);
  assert.equal(fixture.state.committed, true);
  assert.equal(fixture.state.rolledBack, false);
  assert.equal(fixture.state.released, true);

  const bookingQuery = fixture.calls.find(
    (call) => call.sql.includes('FROM bookings')
  );

  assert.deepEqual(bookingQuery.values, [15, 41]);
  assert.match(bookingQuery.sql, /FOR UPDATE/);

  const disputeInsert = fixture.calls.find(
    (call) => call.sql.includes('INSERT INTO service_disputes')
  );

  assert.deepEqual(
    disputeInsert.values,
    [15, 41, 27, 'Service quality issue', 'The service was not completed properly.']
  );

  const historyInsert = fixture.calls.find(
    (call) => call.sql.includes('INSERT INTO dispute_status_history')
  );

  assert.deepEqual(historyInsert.values, [90, 41]);
});

test('customer cannot dispute a booking that is not completed', async (t) => {
  const fixture = createDisputePool({
    booking: {
      id: 15,
      customer_id: 41,
      provider_id: 27,
      status: 'pending',
      disputeWindowOpen: true
    }
  });

  const server = await startServer(customerApp(fixture.pool));
  t.after(() => server.close());

  const response = await fetch(
    `${server.baseUrl}/api/customer/bookings/15/dispute`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: 'Service issue',
        description: 'The service was not completed.'
      })
    }
  );

  assert.equal(response.status, 409);
  assert.equal(fixture.state.rolledBack, true);
  assert.equal(fixture.state.committed, false);
});

test('customer cannot dispute after the 24-hour window', async (t) => {
  const fixture = createDisputePool({
    booking: {
      id: 15,
      customer_id: 41,
      provider_id: 27,
      status: 'completed',
      disputeWindowOpen: false
    }
  });

  const server = await startServer(customerApp(fixture.pool));
  t.after(() => server.close());

  const response = await fetch(
    `${server.baseUrl}/api/customer/bookings/15/dispute`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: 'Service issue',
        description: 'The service was not completed.'
      })
    }
  );

  assert.equal(response.status, 409);
  assert.equal(fixture.state.rolledBack, true);
});

test('customer cannot create a duplicate dispute', async (t) => {
  const fixture = createDisputePool({ duplicate: true });
  const server = await startServer(customerApp(fixture.pool));

  t.after(() => server.close());

  const response = await fetch(
    `${server.baseUrl}/api/customer/bookings/15/dispute`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: 'Service issue',
        description: 'The service was not completed.'
      })
    }
  );

  assert.equal(response.status, 409);
  assert.equal(fixture.state.rolledBack, true);
  assert.equal(fixture.state.released, true);
});

test('history insert failure rolls back dispute creation', async (t) => {
  const fixture = createDisputePool({ failHistory: true });
  const server = await startServer(customerApp(fixture.pool));

  t.after(() => server.close());

  const response = await fetch(
    `${server.baseUrl}/api/customer/bookings/15/dispute`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: 'Service issue',
        description: 'The service was not completed.'
      })
    }
  );

  assert.equal(response.status, 500);
  assert.equal(fixture.state.committed, false);
  assert.equal(fixture.state.rolledBack, true);
  assert.equal(fixture.state.released, true);
});
