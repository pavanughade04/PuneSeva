
const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createCustomerRouter } = require('../routes/customer');
const { createProviderRouter } = require('../routes/provider');

const schema = { users: new Set(['is_active']) };

function futureAppointment() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const bookingDate = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');

  return { bookingDate, bookingTime: '10:30' };
}

// Normalize SQL whitespace for reliable mock matching.
function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

async function startServer(configure) {
  const app = express();

  app.use(express.json());
  configure(app);

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(500).json({ error: 'Request failed.' });
  });

  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

function customerApp(pool, { userId = 41 } = {}) {
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

  return app;
}

function providerApp(pool, { userId = 27, role = 'provider' } = {}) {
  const app = express();

  app.use(express.json());

  app.use(
    '/api/provider',
    (req, res, next) => {
      req.user = { id: userId, role };
      next();
    },
    requireRole('provider'),
    createProviderRouter({ pool })
  );

  return app;
}

function createBookingPool({
  serviceRows,
  conflicts = [],
  insertId = 70,
  failAfterBegin
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
      calls.push({ sql, values });

      const normalized = normalizeSql(sql);

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

      if (normalized.includes('FROM services AS s')) {
        return {
          rows: serviceRows,
          rowCount: serviceRows.length
        };
      }

      if (normalized.includes('SELECT user_id FROM provider_profiles')) {
        return { rows: [], rowCount: 0 };
      }

      if (
        normalized.includes('FROM bookings') &&
        normalized.includes('SELECT id')
      ) {
        return {
          rows: conflicts,
          rowCount: conflicts.length
        };
      }

      if (normalized.includes('INSERT INTO bookings')) {
        if (failAfterBegin) {
          throw new Error('test insert failure');
        }

        return {
          rows: [{ id: insertId }],
          rowCount: 1
        };
      }

      throw new Error(`Unexpected SQL in test: ${sql}`);
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

function validBooking(overrides = {}) {
  return {
    serviceId: 5,
    ...futureAppointment(),
    address: '21 Example Road, Pune',
    phone: '+919876543210',
    notes: 'Please call on arrival.',
    ...overrides
  };
}

// ==========================================
// CUSTOMER BOOKING CREATION
// ==========================================

test(
  'customer creates a booking using authenticated customer, service owner and database price',
  async (t) => {
    const fixture = createBookingPool({
      serviceRows: [{
        id: 5,
        providerId: 27,
        price: '750.00'
      }]
    });

    const server = await startServer((app) => {
      app.use(customerApp(fixture.pool));
    });

    t.after(() => server.close());

    const response = await fetch(
      `${server.baseUrl}/api/customer/bookings`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          validBooking({ providerId: 999, price: 1 })
        )
      }
    );

    const result = await response.json();

    assert.equal(response.status, 201);
    assert.equal(result.booking.id, 70);
    assert.equal(result.booking.providerId, 27);
    assert.equal(result.booking.totalAmount, '750.00');
    assert.equal(result.booking.status, 'pending');

    const insert = fixture.calls.find((call) =>
      call.sql.includes('INSERT INTO bookings')
    );

    assert.deepEqual(insert.values, [
      41,
      27,
      5,
      validBooking().bookingDate,
      '10:30',
      '21 Example Road, Pune',
      '+919876543210',
      'Please call on arrival.',
      '750.00'
    ]);

    assert.equal(fixture.state.began, true);
    assert.equal(fixture.state.committed, true);
    assert.equal(fixture.state.released, true);
  }
);

test(
  'unauthenticated users cannot create bookings',
  async (t) => {
    let connectionRequested = false;

    const app = express();
    app.use(express.json());

    const pool = {
      query: async () => {
        throw new Error(
          'an unauthenticated request must not query users'
        );
      },

      connect: async () => {
        connectionRequested = true;

        throw new Error(
          'an unauthenticated request must not open a transaction'
        );
      }
    };

    app.use(
      '/api/customer',
      requireAuth(pool, schema),
      requireRole('customer'),
      createCustomerRouter({ pool, schema })
    );

    const server = await startServer((serverApp) => {
      serverApp.use(app);
    });

    t.after(() => server.close());

    const response = await fetch(
      `${server.baseUrl}/api/customer/bookings`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBooking())
      }
    );

    assert.equal(response.status, 401);
    assert.equal(connectionRequested, false);
  }
);

test(
  'customer booking rejects past dates and invalid fields before opening a transaction',
  async (t) => {
    let connectionRequested = false;

    const server = await startServer((app) => {
      app.use(customerApp({
        connect: async () => {
          connectionRequested = true;

          throw new Error(
            'Invalid booking must not open a transaction'
          );
        }
      }));
    });

    t.after(() => server.close());

    const response = await fetch(
      `${server.baseUrl}/api/customer/bookings`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          validBooking({
            bookingDate: '2000-01-01',
            phone: 'bad',
            address: 'x'
          })
        )
      }
    );

    assert.equal(response.status, 400);
    assert.equal(connectionRequested, false);
  }
);

test(
  'customer cannot book unapproved or inactive services',
  async (t) => {
    const fixture = createBookingPool({
      serviceRows: []
    });

    const server = await startServer((app) => {
      app.use(customerApp(fixture.pool));
    });

    t.after(() => server.close());

    const response = await fetch(
      `${server.baseUrl}/api/customer/bookings`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBooking())
      }
    );

    assert.equal(response.status, 404);

    assert.match(
      (await response.json()).error,
      /not currently available/
    );

    assert.equal(fixture.state.rolledBack, true);

    // BEGIN + service lookup + ROLLBACK
    assert.equal(fixture.calls.length, 3);

    assert.match(
      fixture.calls[1].sql,
      /s\.approval_status = 'approved'/
    );

    assert.match(
      fixture.calls[1].sql,
      /s\.is_available = TRUE/i
    );
  }
);

test(
  'customer booking rejects a provider time conflict and releases its lock',
  async (t) => {
    const fixture = createBookingPool({
      serviceRows: [{
        id: 5,
        providerId: 27,
        price: '750.00'
      }],
      conflicts: [{ id: 10 }]
    });

    const server = await startServer((app) => {
      app.use(customerApp(fixture.pool));
    });

    t.after(() => server.close());

    const response = await fetch(
      `${server.baseUrl}/api/customer/bookings`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBooking())
      }
    );

    assert.equal(response.status, 409);
    assert.equal(fixture.state.rolledBack, true);
    assert.equal(fixture.state.committed, false);
    assert.equal(fixture.state.released, true);

    assert.equal(
      fixture.calls.some((call) =>
        call.sql.includes('INSERT INTO bookings')
      ),
      false
    );
  }
);

test(
  'customer booking rolls back database errors and returns the connection',
  async (t) => {
    const fixture = createBookingPool({
      serviceRows: [{
        id: 5,
        providerId: 27,
        price: '750.00'
      }],
      failAfterBegin: true
    });

    const server = await startServer((app) => {
      app.use(customerApp(fixture.pool));
    });

    t.after(() => server.close());

    const response = await fetch(
      `${server.baseUrl}/api/customer/bookings`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBooking())
      }
    );

    assert.equal(response.status, 500);
    assert.equal(fixture.state.rolledBack, true);
    assert.equal(fixture.state.released, true);
  }
);

// ==========================================
// CUSTOMER BOOKING LIST AND DETAILS
// ==========================================

test(
  'customers see only their own booking list and details',
  async (t) => {
    const calls = [];

    const pool = {
      query: async (sql, values = []) => {
        calls.push({ sql, values });

        return {
          rows: [{ id: 12, status: 'pending' }],
          rowCount: 1
        };
      }
    };

    const server = await startServer((app) => {
      app.use(customerApp(pool, { userId: 41 }));
    });

    t.after(() => server.close());

    let response = await fetch(
      `${server.baseUrl}/api/customer/bookings`
    );

    assert.equal(response.status, 200);

    assert.deepEqual(
      (await response.json()).bookings,
      [{ id: 12, status: 'pending' }]
    );

    assert.match(
      calls[0].sql,
      /WHERE b\.customer_id = \$1/
    );

    assert.deepEqual(calls[0].values, [41]);

    response = await fetch(
      `${server.baseUrl}/api/customer/bookings/12`
    );

    assert.equal(response.status, 200);

    assert.match(
      calls[1].sql,
      /WHERE b\.id = \$1 AND b\.customer_id = \$2/
    );

    assert.deepEqual(calls[1].values, [12, 41]);
  }
);

test(
  'customers can cancel only eligible bookings belonging to themselves',
  async (t) => {
    let call;

    const server = await startServer((app) => {
      app.use(customerApp({
        query: async (sql, values = []) => {
          call = { sql, values };

          return {
            rows: [],
            rowCount: 1
          };
        }
      }, { userId: 41 }));
    });

    t.after(() => server.close());

    const response = await fetch(
      `${server.baseUrl}/api/customer/bookings/15/cancel`,
      { method: 'PUT' }
    );

    assert.equal(response.status, 200);

    const normalized = normalizeSql(call.sql);

    assert.match(
      normalized,
      /WHERE id = \$1 AND customer_id = \$2 AND status IN \('pending', 'accepted'\)/
    );

    assert.deepEqual(call.values, [15, 41]);
  }
);

// ==========================================
// PROVIDER BOOKING LIST
// ==========================================

test(
  'provider booking list is restricted to that provider account',
  async (t) => {
    let call;

    const server = await startServer((app) => {
      app.use(providerApp({
        query: async (sql, values = []) => {
          call = { sql, values };

          return {
            rows: [],
            rowCount: 0
          };
        }
      }, { userId: 27 }));
    });

    t.after(() => server.close());

    const response = await fetch(
      `${server.baseUrl}/api/provider/bookings`
    );

    assert.equal(response.status, 200);

    assert.deepEqual(
      (await response.json()).bookings,
      []
    );

    assert.match(
      normalizeSql(call.sql),
      /WHERE b\.provider_id = \$1/
    );

    assert.deepEqual(call.values, [27]);
  }
);

// ==========================================
// PROVIDER BOOKING ACCEPTANCE
// ==========================================

test(
  'provider accepts a pending booking only for their own provider id',
  async (t) => {
    const calls = [];

    const pool = {
      query: async (sql, values = []) => {
        calls.push({ sql, values });

        const normalized = normalizeSql(sql);

        if (
          normalized.startsWith('SELECT status FROM bookings')
        ) {
          return {
            rows: [{ status: 'pending' }],
            rowCount: 1
          };
        }

        if (normalized.startsWith('UPDATE bookings')) {
          return {
            rows: [],
            rowCount: 1
          };
        }

        throw new Error(`Unexpected SQL in test: ${sql}`);
      }
    };

    const server = await startServer((app) => {
      app.use(providerApp(pool));
    });

    t.after(() => server.close());

    const response = await fetch(
      `${server.baseUrl}/api/provider/bookings/13/status`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'accepted' })
      }
    );

    assert.equal(response.status, 200);

    assert.equal(
      (await response.json()).booking.status,
      'accepted'
    );

    assert.deepEqual(calls[0].values, [13, 27]);

    assert.match(
      normalizeSql(calls[1].sql),
      /WHERE id = \$\d+ AND provider_id = \$\d+ AND status = \$\d+/
    );
  }
);

// ==========================================
// PROVIDER BOOKING REJECTION
// ==========================================

test(
  'provider rejects bookings with a reason visible to the customer',
  async (t) => {
    let update;

    const pool = {
      query: async (sql, values = []) => {
        const normalized = normalizeSql(sql);

        if (
          normalized.startsWith('SELECT status FROM bookings')
        ) {
          return {
            rows: [{ status: 'pending' }],
            rowCount: 1
          };
        }

        if (normalized.startsWith('UPDATE bookings')) {
          update = { sql, values };

          return {
            rows: [],
            rowCount: 1
          };
        }

        throw new Error(`Unexpected SQL in test: ${sql}`);
      }
    };

    const server = await startServer((app) => {
      app.use(providerApp(pool));
    });

    t.after(() => server.close());

    const response = await fetch(
      `${server.baseUrl}/api/provider/bookings/13/status`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'rejected',
          rejectionReason: 'Provider is unavailable.'
        })
      }
    );

    assert.equal(response.status, 200);

    assert.equal(
      update.values[1],
      'Provider is unavailable.'
    );
  }
);

test(
  'provider rejection requires a valid reason',
  async (t) => {
    let databaseCalled = false;

    const server = await startServer((app) => {
      app.use(providerApp({
        query: async () => {
          databaseCalled = true;

          return {
            rows: [],
            rowCount: 0
          };
        }
      }));
    });

    t.after(() => server.close());

    const response = await fetch(
      `${server.baseUrl}/api/provider/bookings/13/status`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'rejected',
          rejectionReason: 'no'
        })
      }
    );

    assert.equal(response.status, 400);
    assert.equal(databaseCalled, false);
  }
);

// ==========================================
// PROVIDER BOOKING STATUS TRANSITIONS
// ==========================================

test(
  'provider status transitions support start and complete but reject invalid transitions',
  async (t) => {
    const calls = [];
    let currentStatus = 'accepted';

    const pool = {
      query: async (sql, values = []) => {
        calls.push({ sql, values });

        const normalized = normalizeSql(sql);

        if (
          normalized.startsWith('SELECT status FROM bookings')
        ) {
          return {
            rows: [{ status: currentStatus }],
            rowCount: 1
          };
        }

        if (normalized.startsWith('UPDATE bookings')) {
          currentStatus = values[0];

          return {
            rows: [],
            rowCount: 1
          };
        }

        throw new Error(`Unexpected SQL in test: ${sql}`);
      }
    };

    const server = await startServer((app) => {
      app.use(providerApp(pool));
    });

    t.after(() => server.close());

    let response = await fetch(
      `${server.baseUrl}/api/provider/bookings/13/status`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' })
      }
    );

    assert.equal(response.status, 200);
    assert.equal(currentStatus, 'in_progress');

    response = await fetch(
      `${server.baseUrl}/api/provider/bookings/13/status`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' })
      }
    );

    assert.equal(response.status, 200);
    assert.equal(currentStatus, 'completed');

    response = await fetch(
      `${server.baseUrl}/api/provider/bookings/13/status`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'accepted' })
      }
    );

    assert.equal(response.status, 409);
    assert.equal(currentStatus, 'completed');
  }
);

// ==========================================
// ROLE AUTHORIZATION
// ==========================================

test(
  'customers cannot call provider booking status actions',
  async (t) => {
    let databaseCalled = false;

    const server = await startServer((app) => {
      app.use(providerApp({
        query: async () => {
          databaseCalled = true;

          return {
            rows: [],
            rowCount: 0
          };
        }
      }, { role: 'customer' }));
    });

    t.after(() => server.close());

    const response = await fetch(
      `${server.baseUrl}/api/provider/bookings/13/status`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'accepted' })
      }
    );

    assert.equal(response.status, 403);
    assert.equal(databaseCalled, false);
  }
);
