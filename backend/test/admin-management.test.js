
const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const express = require('express');
const session = require('express-session');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createAdminRouter } = require('../routes/admin');

const schema = {
  users: new Set(['is_active', 'phone']),
  providers: new Set([
    'user_id',
    'business_name',
    'approval_status',
    'experience_years',
    'service_area',
    'description'
  ]),
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

function adminApp(pool, currentSchema = schema) {
  return (app) => {
    app.use(
      '/api/admin',
      (req, res, next) => {
        req.user = { id: 8, role: 'admin' };
        next();
      },
      requireRole('admin'),
      createAdminRouter({ pool, schema: currentSchema })
    );
  };
}

function transactionPool({ bookingStatus = 'pending' } = {}) {
  const calls = [];

  const state = {
    committed: false,
    rolledBack: false,
    released: false
  };

  const connection = {
    query: async (sql, values = []) => {
      calls.push({ sql, values });

      if (
        sql === 'BEGIN' ||
        sql === 'COMMIT' ||
        sql === 'ROLLBACK'
      ) {
        if (sql === 'COMMIT') state.committed = true;
        if (sql === 'ROLLBACK') state.rolledBack = true;

        return { rows: [], rowCount: null };
      }

      if (sql.includes('SELECT p.user_id')) {
        return {
          rows: [{ user_id: 27 }],
          rowCount: 1
        };
      }

      if (sql.includes('SELECT id, status FROM bookings')) {
        return {
          rows: [{ id: 44, status: bookingStatus }],
          rowCount: 1
        };
      }

      if (sql.startsWith('SELECT id FROM reviews')) {
        return {
          rows: [{ id: 61 }],
          rowCount: 1
        };
      }

      if (sql.startsWith('SELECT id FROM services')) {
        return {
          rows: [{ id: 33 }],
          rowCount: 1
        };
      }

      if (sql.startsWith('INSERT INTO admin_audit_log')) {
        return {
          rows: [{ id: 1 }],
          rowCount: 1
        };
      }

      if (
        sql.startsWith('UPDATE') ||
        sql.startsWith('DELETE')
      ) {
        return {
          rows: [],
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

// ==========================================
// PROVIDER REJECTION
// ==========================================

test(
  'admin provider rejection requires and records a reason transactionally',
  async (t) => {
    const fixture = transactionPool();
    const server = await startServer(adminApp(fixture.pool));

    t.after(() => server.close());

    let response = await fetch(
      `${server.baseUrl}/api/admin/providers/27/reject`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'no' })
      }
    );

    assert.equal(response.status, 400);
    assert.equal(fixture.calls.length, 0);

    response = await fetch(
      `${server.baseUrl}/api/admin/providers/27/reject`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: 'Application details are incomplete.'
        })
      }
    );

    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.provider.approvalStatus, 'rejected');
    assert.equal(
      result.provider.reason,
      'Application details are incomplete.'
    );

    assert.equal(fixture.state.committed, true);
    assert.equal(fixture.state.released, true);

    const audit = fixture.calls.find((call) =>
      call.sql.startsWith('INSERT INTO admin_audit_log')
    );

    assert.deepEqual(audit.values, [
      8,
      'provider',
      27,
      'rejected',
      'Application details are incomplete.'
    ]);
  }
);

// ==========================================
// BOOKING CANCELLATION
// ==========================================

test(
  'admin booking cancellation keeps Phase 6 transitions and records its reason',
  async (t) => {
    const fixture = transactionPool({
      bookingStatus: 'accepted'
    });

    const server = await startServer(adminApp(fixture.pool));

    t.after(() => server.close());

    const response = await fetch(
      `${server.baseUrl}/api/admin/bookings/44/cancel`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: 'Customer requested cancellation.'
        })
      }
    );

    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.booking.status, 'cancelled');

    const update = fixture.calls.find((call) =>
      call.sql.startsWith('UPDATE bookings')
    );

    assert.match(
      update.sql,
      /status IN \('pending', 'accepted', 'in_progress'\)/
    );

    assert.doesNotMatch(update.sql, /rejection_reason/);

    const audit = fixture.calls.find((call) =>
      call.sql.startsWith('INSERT INTO admin_audit_log')
    );

    assert.deepEqual(audit.values, [
      8,
      'booking',
      44,
      'cancelled',
      'Customer requested cancellation.'
    ]);

    assert.equal(fixture.state.committed, true);
  }
);

test(
  'admin cannot cancel a completed booking',
  async (t) => {
    const fixture = transactionPool({
      bookingStatus: 'completed'
    });

    const server = await startServer(adminApp(fixture.pool));

    t.after(() => server.close());

    const response = await fetch(
      `${server.baseUrl}/api/admin/bookings/44/cancel`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: 'Administrative request.'
        })
      }
    );

    assert.equal(response.status, 409);

    assert.equal(
      fixture.calls.some((call) =>
        call.sql.startsWith('UPDATE bookings')
      ),
      false
    );

    assert.equal(
      fixture.calls.some((call) =>
        call.sql.startsWith('INSERT INTO admin_audit_log')
      ),
      false
    );

    assert.equal(fixture.state.committed, true);
  }
);

// ==========================================
// CONTACT MESSAGE STATUS
// ==========================================

test(
  'admin message status update returns a confirmation and the updated message',
  async (t) => {
    const calls = [];

    const pool = {
      query: async (sql, values = []) => {
        calls.push({ sql, values });

        if (sql.includes('information_schema.tables')) {
          return {
            rows: [{ present: true }],
            rowCount: 1
          };
        }

        throw new Error(`Unexpected pool SQL in test: ${sql}`);
      },

      connect: async () => ({
        query: async (sql, values = []) => {
          calls.push({ sql, values });

          if (
            sql === 'BEGIN' ||
            sql === 'COMMIT' ||
            sql === 'ROLLBACK'
          ) {
            return { rows: [], rowCount: 0 };
          }

          if (sql.startsWith('UPDATE contact_messages')) {
            return {
              rows: [{ id: 73, status: 'resolved' }],
              rowCount: 1
            };
          }

          if (sql.includes('INSERT INTO admin_audit_log')) {
            return { rows: [], rowCount: 1 };
          }

          throw new Error(`Unexpected transaction SQL: ${sql}`);
        },

        release: () => {}
      })
    };

    const server = await startServer(adminApp(pool));

    t.after(() => server.close());

    const response = await fetch(
      `${server.baseUrl}/api/admin/messages/73/status`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' })
      }
    );

    const result = await response.json();

    assert.equal(response.status, 200);

    assert.deepEqual(result, {
      message: 'Message status updated.',
      contactMessage: {
        id: 73,
        status: 'resolved'
      }
    });

    const updateCall = calls.find((call) =>
      call.sql.startsWith('UPDATE contact_messages')
    );

    assert.deepEqual(updateCall.values, [
      'resolved',
      73
    ]);

    assert.equal(
      calls.some((call) =>
        call.sql.includes('INSERT INTO admin_audit_log')
      ),
      true
    );
  }
);

// ==========================================
// SERVICE LIST
// ==========================================

test(
  'admin service list uses PostgreSQL columns and paginates',
  async (t) => {
    const calls = [];

    const pool = {
      query: async (sql, values = []) => {
        calls.push({ sql, values });

        if (sql.includes('COUNT(*)')) {
          return {
            rows: [{ total: '13' }],
            rowCount: 1
          };
        }

        return {
          rows: [{
            id: 33,
            serviceName: 'Cleaning',
            isAvailable: true,
            approvalStatus: 'approved',
            priceType: 'fixed'
          }],
          rowCount: 1
        };
      }
    };

    const server = await startServer(adminApp(pool));

    t.after(() => server.close());

    const response = await fetch(
      `${server.baseUrl}/api/admin/services?status=all&category=Cleaning&page=2&limit=5`
    );

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
    assert.equal(result.services[0].priceType, 'fixed');

    assert.match(
      calls[1].sql,
      /s\.price_type AS "priceType"/
    );

    assert.match(
      calls[1].sql,
      /s\.approval_status AS "approvalStatus"/
    );

    assert.doesNotMatch(
      calls[1].sql,
      /'fixed' AS "priceType"/
    );

    assert.deepEqual(calls[1].values, [
      'Cleaning',
      5,
      5
    ]);
  }
);

// ==========================================
// AUTHORIZATION TESTS
// ==========================================

test(
  'unauthenticated and customer sessions cannot reach admin APIs',
  async (t) => {
    let databaseCalls = 0;

    const pool = {
      query: async () => {
        databaseCalls += 1;

        return {
          rows: [{
            id: 14,
            full_name: 'Customer',
            email: 'customer@example.com',
            role: 'customer'
          }],
          rowCount: 1
        };
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

      app.use(
        '/api/admin',
        requireAuth(pool, schema),
        requireRole('admin'),
        createAdminRouter({ pool, schema })
      );
    });

    t.after(() => server.close());

    let response = await fetch(
      `${server.baseUrl}/api/admin/dashboard/stats`
    );

    assert.equal(response.status, 401);
    assert.equal(databaseCalls, 0);

    const login = await fetch(
      `${server.baseUrl}/test-login`
    );

    const cookie = login.headers.get('set-cookie').split(';')[0];

    response = await fetch(
      `${server.baseUrl}/api/admin/dashboard/stats`,
      {
        headers: { Cookie: cookie }
      }
    );

    assert.equal(response.status, 403);
    assert.equal(databaseCalls, 1);
  }
);

test(
  'provider sessions cannot reach admin APIs',
  async (t) => {
    let databaseCalls = 0;

    const pool = {
      query: async () => {
        databaseCalls += 1;

        return {
          rows: [{
            id: 27,
            full_name: 'Provider',
            email: 'provider@example.com',
            role: 'provider'
          }],
          rowCount: 1
        };
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

      app.use(
        '/api/admin',
        requireAuth(pool, schema),
        requireRole('admin'),
        createAdminRouter({ pool, schema })
      );
    });

    t.after(() => server.close());

    const login = await fetch(
      `${server.baseUrl}/test-login`
    );

    const cookie = login.headers.get('set-cookie').split(';')[0];

    const response = await fetch(
      `${server.baseUrl}/api/admin/dashboard/stats`,
      {
        headers: { Cookie: cookie }
      }
    );

    assert.equal(response.status, 403);
    assert.equal(databaseCalls, 1);
  }
);

test(
  'admin dashboard stats returns nested counts and recent activity',
  async (t) => {
    const calls = [];

    const pool = {
      query: async (sql) => {
        calls.push(sql);

        if (sql.includes('customers_total')) {
          return {
            rows: [{
              customers_total: '12',
              providers_total: '5',
              providers_pending: '2',
              services_total: '20',
              services_pending: '3',
              bookings_total: '30',
              bookings_pending: '4',
              bookings_completed: '18',
              bookings_cancelled: '2',
              reviews_total: '10'
            }],
            rowCount: 1
          };
        }

        if (sql.includes('FROM bookings b')) {
          return {
            rows: [{
              id: 44,
              customerName: 'Test Customer',
              providerName: 'Test Provider',
              serviceName: 'Cleaning',
              status: 'pending',
              createdAt: '2026-11-25T08:00:00.000Z'
            }],
            rowCount: 1
          };
        }

        if (sql.includes('FROM provider_profiles p')) {
          return {
            rows: [{
              fullName: 'Test Provider',
              businessName: 'Test Services',
              approvalStatus: 'pending',
              createdAt: '2026-11-25T07:00:00.000Z'
            }],
            rowCount: 1
          };
        }

        if (sql.includes('FROM services s')) {
          return {
            rows: [{
              id: 33,
              serviceName: 'Cleaning',
              providerName: 'Test Provider',
              category: 'Home Services',
              approvalStatus: 'approved'
            }],
            rowCount: 1
          };
        }

        throw new Error(`Unexpected SQL: ${sql}`);
      }
    };

    const server = await startServer(adminApp(pool));

    t.after(() => server.close());

    const response = await fetch(
      `${server.baseUrl}/api/admin/dashboard/stats`
    );

    const result = await response.json();

    assert.equal(response.status, 200);

    assert.deepEqual(result.stats, {
      customers: { total: '12' },
      providers: { total: '5', pending: '2' },
      services: { total: '20', pending: '3' },
      bookings: {
        total: '30',
        pending: '4',
        completed: '18',
        cancelled: '2'
      },
      reviews: { total: '10' }
    });

    assert.equal(result.recentActivity.recentBookings[0].id, 44);
    assert.equal(
      result.recentActivity.recentBookings[0].customerName,
      'Test Customer'
    );

    assert.equal(
      result.recentActivity.recentProviders[0].approvalStatus,
      'pending'
    );

    assert.equal(
      result.recentActivity.recentServices[0].serviceName,
      'Cleaning'
    );

    assert.equal(calls.length, 4);
  }
);

test(
  'admin customer list, detail and account status APIs return expected data',
  async (t) => {
    const calls = [];

    const pool = {
      query: async (sql, values = []) => {
        calls.push({ sql, values });

        if (sql.includes('COUNT(*) AS total')) {
          return {
            rows: [{ total: '1' }],
            rowCount: 1
          };
        }

        if (sql.includes('LEFT JOIN customer_profiles')) {
          return {
            rows: [{
              customerId: 14,
              fullName: 'Test Customer',
              email: 'customer@example.com',
              phone: '9876543210',
              accountStatus: 'active',
              createdAt: '2026-11-25T08:00:00.000Z',
              address: 'Test Address',
              area: 'Test Area',
              city: 'Pune',
              profileImage: null
            }],
            rowCount: 1
          };
        }

        if (
          sql.includes('FROM bookings b') &&
          sql.includes('WHERE b.customer_id = $1')
        ) {
          return {
            rows: [{
              id: 44,
              serviceName: 'Cleaning',
              providerName: 'Test Provider',
              bookingDate: '2026-11-26',
              status: 'pending',
              totalAmount: '500'
            }],
            rowCount: 1
          };
        }

        if (
          sql.includes('FROM users u') &&
          sql.includes('bookingCount')
        ) {
          return {
            rows: [{
              customerId: 14,
              fullName: 'Test Customer',
              email: 'customer@example.com',
              phone: '9876543210',
              accountStatus: 'active',
              createdAt: '2026-11-25T08:00:00.000Z',
              bookingCount: 2
            }],
            rowCount: 1
          };
        }

        throw new Error(`Unexpected SQL: ${sql}`);
      },

      connect: async () => ({
        query: async (sql, values = []) => {
          calls.push({ sql, values });

          if (
            sql === 'BEGIN' ||
            sql === 'COMMIT' ||
            sql === 'ROLLBACK'
          ) {
            return { rows: [], rowCount: 0 };
          }

          if (sql.startsWith('UPDATE users')) {
            return {
              rows: [{
                id: 14,
                isActive: false,
                accountStatus: 'blocked'
              }],
              rowCount: 1
            };
          }

          if (sql.includes('INSERT INTO admin_audit_log')) {
            return {
              rows: [],
              rowCount: 1
            };
          }

          throw new Error(`Unexpected transaction SQL: ${sql}`);
        },

        release: () => {}
      })
    };

    const server = await startServer(adminApp(pool));

    t.after(() => server.close());

    // Customer list
    let response = await fetch(
      `${server.baseUrl}/api/admin/customers?page=1&limit=10`
    );

    let result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.customers[0].customerId, 14);
    assert.equal(result.customers[0].accountStatus, 'active');
    assert.equal(result.customers[0].bookingCount, 2);
    assert.equal(result.pagination.total, 1);

    // Customer detail
    response = await fetch(
      `${server.baseUrl}/api/admin/customers/14`
    );

    result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.customer.customerId, 14);
    assert.equal(result.customer.city, 'Pune');
    assert.equal(result.recentBookings[0].serviceName, 'Cleaning');

    // Block customer account
    response = await fetch(
      `${server.baseUrl}/api/admin/customers/14/status`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'blocked' })
      }
    );

    result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.customer.accountStatus, 'blocked');
    assert.equal(result.customer.isActive, false);

    const updateCall = calls.find((call) =>
      call.sql.startsWith('UPDATE users')
    );

    assert.deepEqual(updateCall.values, [false, 14]);

    assert.equal(
      calls.some((call) =>
        call.sql.includes('INSERT INTO admin_audit_log')
      ),
      true
    );
  }
);
