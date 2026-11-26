
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

function createReviewPool({
  booking = {
    id: 15,
    customer_id: 41,
    provider_id: 27,
    status: 'completed'
  },
  dispute = null,
  duplicate = false,
  failInsert = false
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

      if (
        normalized.includes('FROM bookings') &&
        normalized.includes('FOR UPDATE')
      ) {
        return {
          rows: booking ? [booking] : [],
          rowCount: booking ? 1 : 0
        };
      }

      if (normalized.includes('FROM service_disputes')) {
  const activeDispute =
    dispute && ['pending', 'under_review'].includes(dispute.status);

  return {
    rows: activeDispute ? [dispute] : [],
    rowCount: activeDispute ? 1 : 0
  };
}

      if (normalized.includes('INSERT INTO reviews')) {
        if (duplicate) {
          const error = new Error('Duplicate review');
          error.code = '23505';
          error.constraint = 'reviews_booking_id_key';
          throw error;
        }

        if (failInsert) {
          throw new Error('Review insert failed');
        }

        return {
          rows: [{
            id: 101,
            bookingId: 15,
            rating: 5,
            comment: 'Excellent service.',
            createdAt: '2026-11-26T10:00:00'
          }],
          rowCount: 1
        };
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

async function submitReview(server, payload = {}) {
  return fetch(`${server.baseUrl}/api/customer/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bookingId: 15,
      rating: 5,
      comment: 'Excellent service.',
      ...payload
    })
  });
}

test('customer can review their completed booking', async (t) => {
  const fixture = createReviewPool();
  const server = await startServer(customerApp(fixture.pool));

  t.after(() => server.close());

  const response = await submitReview(server);

  assert.equal(response.status, 201);

  const result = await response.json();

  assert.equal(result.review.id, 101);
  assert.equal(result.review.rating, 5);
  assert.equal(fixture.state.began, true);
  assert.equal(fixture.state.committed, true);
  assert.equal(fixture.state.rolledBack, false);
  assert.equal(fixture.state.released, true);

  const bookingQuery = fixture.calls.find(
    (call) => call.sql.includes('FROM bookings')
  );

  assert.deepEqual(bookingQuery.values, [15, 41]);
  assert.match(bookingQuery.sql, /FOR UPDATE/);

  const reviewInsert = fixture.calls.find(
    (call) => call.sql.includes('INSERT INTO reviews')
  );

  assert.deepEqual(
    reviewInsert.values,
    [15, 41, 27, 5, 'Excellent service.']
  );
});

test('customer cannot review a booking that is not completed', async (t) => {
  const fixture = createReviewPool({
    booking: {
      id: 15,
      customer_id: 41,
      provider_id: 27,
      status: 'pending'
    }
  });

  const server = await startServer(customerApp(fixture.pool));
  t.after(() => server.close());

  const response = await submitReview(server);

  assert.equal(response.status, 409);
  assert.equal(fixture.state.rolledBack, true);
  assert.equal(fixture.state.committed, false);
});

test('customer cannot review another customer booking', async (t) => {
  const fixture = createReviewPool({ booking: null });
  const server = await startServer(customerApp(fixture.pool));

  t.after(() => server.close());

  const response = await submitReview(server);

  assert.equal(response.status, 404);
  assert.equal(fixture.state.rolledBack, true);
  assert.equal(fixture.state.committed, false);
});

test('pending dispute blocks review submission', async (t) => {
  const fixture = createReviewPool({
    dispute: { id: 90, status: 'pending' }
  });

  const server = await startServer(customerApp(fixture.pool));
  t.after(() => server.close());

  const response = await submitReview(server);

  assert.equal(response.status, 409);
  assert.equal(fixture.state.rolledBack, true);
  assert.equal(fixture.state.committed, false);
});

test('under-review dispute blocks review submission', async (t) => {
  const fixture = createReviewPool({
    dispute: { id: 90, status: 'under_review' }
  });

  const server = await startServer(customerApp(fixture.pool));
  t.after(() => server.close());

  const response = await submitReview(server);

  assert.equal(response.status, 409);
  assert.equal(fixture.state.rolledBack, true);
});

test('resolved dispute does not block review submission', async (t) => {
    const fixture = createReviewPool({
    dispute: { id: 90, status: 'resolved' }
  });
  const server = await startServer(customerApp(fixture.pool));

  t.after(() => server.close());

  const response = await submitReview(server);

  assert.equal(response.status, 201);
});

test('customer cannot submit a duplicate review', async (t) => {
  const fixture = createReviewPool({ duplicate: true });
  const server = await startServer(customerApp(fixture.pool));

  t.after(() => server.close());

  const response = await submitReview(server);

  assert.equal(response.status, 409);
  assert.equal(fixture.state.rolledBack, true);
  assert.equal(fixture.state.released, true);
});

test('invalid rating is rejected', async (t) => {
  const fixture = createReviewPool();
  const server = await startServer(customerApp(fixture.pool));

  t.after(() => server.close());

  const response = await submitReview(server, { rating: 6 });

  assert.equal(response.status, 400);
  assert.equal(fixture.state.began, false);
  assert.equal(fixture.state.released, false);
});

test('review insert failure rolls back transaction', async (t) => {
  const fixture = createReviewPool({ failInsert: true });
  const server = await startServer(customerApp(fixture.pool));

  t.after(() => server.close());

  const response = await submitReview(server);

  assert.equal(response.status, 500);
  assert.equal(fixture.state.committed, false);
  assert.equal(fixture.state.rolledBack, true);
  assert.equal(fixture.state.released, true);
});
