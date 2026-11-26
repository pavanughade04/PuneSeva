
const { PassThrough } = require('node:stream');
const cloudinary = require('../config/cloudinary');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { test } = require('node:test');
const express = require('express');

const { requireRole } = require('../middleware/auth');
const { createAdminRouter } = require('../routes/admin');
const { createProviderRouter } = require('../routes/provider');
const { createServicesRouter } = require('../routes/services');
const { removeServiceImage } = require('../middleware/service-image-upload');

const schema = {
  users: new Set(['is_active']),
  services: new Set(['approval_status', 'price_type'])
};

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

async function startServer(configure) {
  const app = express();
  app.use(express.json());
  configure(app);

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

function providerApp(pool, role = 'provider') {
  const app = express();
  app.use(express.json());

  app.use(
    '/api/provider',
    (req, res, next) => {
      req.user = { id: 27, role };
      next();
    },
    requireRole('provider'),
    createProviderRouter({ pool, schema })
  );

  return app;
}

function adminApp(pool, role = 'admin') {
  const app = express();
  app.use(express.json());

  app.use(
    '/api/admin',
    (req, res, next) => {
      req.user = { id: 9, role };
      next();
    },
    requireRole('admin'),
    createAdminRouter({ pool, schema })
  );

  return app;
}

function pgResult(rows = [], rowCount = rows.length) {
  return { rows, rowCount };
}

// 1
test('public services page is served by the frontend static route', async (t) => {
  const frontendPath = path.join(__dirname, '..', '..', 'frontend');
  const server = await startServer((app) => {
    app.use(express.static(frontendPath));
  });

  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/services.html`);
  const page = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(page, /id="catalog-filters"/);
  assert.match(page, /src="\/js\/services\.js"/);
});

// 2
test('public search only queries approved, available services and returns JSON', async (t) => {
  let executed;

  const pool = {
    query: async (sql, values) => {
      executed = { sql, values };

      return pgResult([{
        id: 3,
        serviceName: 'House cleaning',
        category: 'Cleaning',
        image: '/uploads/cleaning.png',
        isAvailable: true,
        createdAt: '2026-01-01T00:00:00.000Z'
      }]);
    }
  };

  const server = await startServer((app) => {
    app.use('/api/services', createServicesRouter({ pool, schema }));
  });

  t.after(() => server.close());

  const response = await fetch(
    `${server.baseUrl}/api/services?search=clean&category=Cleaning&location=Kothrud&sort=price_asc`
  );

  const result = await response.json();
  const sql = normalizeSql(executed.sql);

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('content-type').includes('application/json'),
    true
  );

  assert.match(sql, /s\.approval_status = \$\d+/);
  assert.match(sql, /s\.is_available = TRUE/);
  assert.match(sql, /p\.approval_status = \$\d+/);
  assert.match(sql, /s\.location ILIKE \$\d+/);
  assert.match(sql, /ORDER BY s\.price ASC, s\.id ASC/);

  assert.ok(executed.values.includes('Cleaning'));
  assert.ok(executed.values.includes('%Kothrud%'));
  assert.ok(executed.values.includes('%clean%'));

  assert.equal(result.services[0].isAvailable, true);
  assert.equal(result.services[0].image, '/uploads/cleaning.png');
});

// 3
test('public service details hide unavailable and unapproved listings', async (t) => {
  let executed;

  const pool = {
    query: async (sql, values) => {
      executed = { sql, values };
      return pgResult([]);
    }
  };

  const server = await startServer((app) => {
    app.use('/api/services', createServicesRouter({ pool, schema }));
  });

  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/services/41`);
  const result = await response.json();
  const sql = normalizeSql(executed.sql);

  assert.equal(response.status, 404);
  assert.equal(result.error, 'Service not found.');
  assert.match(sql, /s\.approval_status = \$\d+/);
  assert.match(sql, /s\.is_available = TRUE/);
  assert.deepEqual(executed.values, [41, 'approved', 'approved']);
});

// 4
test('provider-created services are pending and tied to the session provider', async (t) => {
  const calls = [];

  const pool = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      const normalized = normalizeSql(sql);

      if (normalized.startsWith('SELECT approval_status FROM provider_profiles')) {
        return pgResult([{ approval_status: 'approved' }]);
      }

      if (normalized.startsWith('INSERT INTO services')) {
        return pgResult([{ id: 55 }], 1);
      }

      throw new Error('Unexpected SQL in test: ' + sql);
    }
  };

  const server = await startServer((app) => {
    app.use(providerApp(pool));
  });

  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/provider/services`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      serviceName: 'Home cleaning',
      category: 'Cleaning',
      description: 'Cleaning for apartments and houses.',
      location: 'Kothrud, Pune',
      price: 500,
      priceType: 'fixed',
      isAvailable: true
    })
  });

  const result = await response.json();

  assert.equal(response.status, 201);
  assert.equal(result.service.approvalStatus, 'pending');
  assert.equal(result.service.location, 'Kothrud, Pune');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].values[0], 27);
  assert.ok(calls[1].values.includes('Kothrud, Pune'));
  assert.match(calls[1].sql, /'pending'/);
  assert.match(calls[1].sql, /RETURNING id/);
});

// 5
test('provider can upload a validated image with a service', async (t) => {
  const calls = [];
  let uploadedOptions;

  t.mock.method(
    cloudinary.uploader,
    'upload_stream',
    (options, callback) => {
      uploadedOptions = options;

      const stream = new PassThrough();

      stream.on('finish', () => {
        callback(null, {
          secure_url: `https://res.cloudinary.com/test/image/upload/${options.public_id}.png`
        });
      });

      return stream;
    }
  );

  t.mock.method(
    cloudinary.uploader,
    'destroy',
    async () => ({ result: 'ok' })
  );

  const pool = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      const normalized = normalizeSql(sql);

      if (normalized.startsWith('SELECT approval_status FROM provider_profiles')) {
        return pgResult([{ approval_status: 'approved' }]);
      }

      if (normalized.startsWith('INSERT INTO services')) {
        return pgResult([{ id: 56 }], 1);
      }

      throw new Error('Unexpected SQL in test: ' + sql);
    }
  };

  const server = await startServer((app) => {
    app.use(providerApp(pool));
  });

  t.after(() => server.close());

  const imageBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47,
    0x0d, 0x0a, 0x1a, 0x0a
  ]);

  const form = new FormData();

  form.append('serviceName', 'Home cleaning');
  form.append('category', 'Cleaning');
  form.append('description', 'Cleaning for apartments and houses.');
  form.append('location', 'Kothrud, Pune');
  form.append('price', '500');
  form.append('priceType', 'fixed');
  form.append('isAvailable', 'true');

  form.append(
    'image',
    new Blob([imageBuffer], { type: 'image/png' }),
    'service.png'
  );

  const response = await fetch(`${server.baseUrl}/api/provider/services`, {
    method: 'POST',
    body: form
  });

  const result = await response.json();

  assert.equal(response.status, 201);

  assert.match(
    result.service.image,
    /^https:\/\/res\.cloudinary\.com\/test\/image\/upload\/[0-9a-f-]{36}\.png$/
  );

  assert.ok(calls[1].values.includes(result.service.image));
  assert.equal(uploadedOptions.resource_type, 'image');
  assert.equal(uploadedOptions.overwrite, false);
  assert.ok(uploadedOptions.public_id);
});

// 6
test('provider image upload rejects content that does not match its image type', async (t) => {
  let databaseCalled = false;

  const pool = {
    query: async () => {
      databaseCalled = true;
      return pgResult([{ approval_status: 'approved' }]);
    }
  };

  const server = await startServer((app) => {
    app.use(providerApp(pool));
  });

  t.after(() => server.close());

  const form = new FormData();
  form.append('image', new Blob(['not a png'], { type: 'image/png' }), 'fake.png');

  const response = await fetch(`${server.baseUrl}/api/provider/services`, {
    method: 'POST',
    body: form
  });

  const result = await response.json();

  assert.equal(response.status, 400);
  assert.match(result.error, /not a valid JPEG, PNG, or WebP/);
  assert.equal(databaseCalled, false);
});

// 7
test('provider service list is scoped to the signed-in provider', async (t) => {
  let executed;

  const pool = {
    query: async (sql, values) => {
      executed = { sql, values };

      return pgResult([{
        id: 55,
        serviceName: 'Home cleaning',
        location: 'Kothrud, Pune',
        isAvailable: true,
        approvalStatus: 'approved'
      }]);
    }
  };

  const server = await startServer((app) => {
    app.use(providerApp(pool));
  });

  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/provider/services`);
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(executed.values, [27]);
  assert.match(normalizeSql(executed.sql), /WHERE provider_id = \$1/);
  assert.equal(result.services[0].location, 'Kothrud, Pune');
  assert.equal(result.services[0].isAvailable, true);
});

// 8
test('provider cannot edit another provider service', async (t) => {
  const calls = [];

  const pool = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      const normalized = normalizeSql(sql);

      if (normalized.startsWith('SELECT approval_status FROM provider_profiles')) {
        return pgResult([{ approval_status: 'approved' }]);
      }

      if (normalized.startsWith('SELECT image FROM services')) {
        return pgResult([]);
      }

      throw new Error('Unexpected SQL in test: ' + sql);
    }
  };

  const server = await startServer((app) => {
    app.use(providerApp(pool));
  });

  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/provider/services/88`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      serviceName: 'Home cleaning',
      category: 'Cleaning',
      description: 'Cleaning for apartments and houses.',
      location: 'Kothrud, Pune',
      price: 500,
      priceType: 'fixed',
      isAvailable: false
    })
  });

  const result = await response.json();

  assert.equal(response.status, 404);
  assert.equal(result.error, 'Service not found.');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].values, [88, 27]);
  assert.match(
    normalizeSql(calls[1].sql),
    /WHERE id = \$1 AND provider_id = \$2/
  );
});

// 9
test('provider edits reset service approval and save its location', async (t) => {
  const calls = [];

  const pool = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      const normalized = normalizeSql(sql);

      if (normalized.startsWith('SELECT approval_status FROM provider_profiles')) {
        return pgResult([{ approval_status: 'approved' }]);
      }

      if (normalized.startsWith('SELECT image FROM services')) {
        return pgResult([{ image: null }]);
      }

      if (normalized.startsWith('UPDATE services')) {
        return pgResult([], 1);
      }

      if (normalized.startsWith('SELECT id, service_name')) {
        return pgResult([{
          id: 88,
          serviceName: 'Home cleaning',
          location: 'Baner, Pune',
          isAvailable: true,
          approvalStatus: 'pending'
        }]);
      }

      throw new Error('Unexpected SQL in test: ' + sql);
    }
  };

  const server = await startServer((app) => {
    app.use(providerApp(pool));
  });

  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/provider/services/88`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      serviceName: 'Home cleaning',
      category: 'Cleaning',
      description: 'Cleaning for apartments and houses.',
      location: 'Baner, Pune',
      price: 500,
      priceType: 'fixed',
      isAvailable: true
    })
  });

  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.service.approvalStatus, 'pending');
  assert.equal(result.service.location, 'Baner, Pune');
  assert.match(calls[2].sql, /approval_status = 'pending'/);
  assert.ok(calls[2].values.includes('Baner, Pune'));
});

// 10
test('provider service validation rejects missing locations before database access', async (t) => {
  let databaseCalled = false;

  const pool = {
    query: async () => {
      databaseCalled = true;
      return pgResult([]);
    }
  };

  const server = await startServer((app) => {
    app.use(providerApp(pool));
  });

  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/provider/services`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      serviceName: 'Home cleaning',
      category: 'Cleaning',
      price: -1,
      priceType: 'fixed',
      isAvailable: false
    })
  });

  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(databaseCalled, false);
  assert.ok(result.details.some((detail) => detail.field === 'location'));
  assert.ok(result.details.some((detail) => detail.field === 'price'));
});

// 11
test('service with booking history cannot be deleted', async (t) => {
  const pool = {
    query: async (sql) => {
      const normalized = normalizeSql(sql);

      if (normalized.startsWith('SELECT image FROM services')) {
        return pgResult([{ image: null }]);
      }

      if (normalized.startsWith('DELETE FROM services')) {
        const error = new Error('Foreign key constraint');
        error.code = '23503';
        throw error;
      }

      throw new Error('Unexpected SQL in test: ' + sql);
    }
  };

  const server = await startServer((app) => {
    app.use(providerApp(pool));
  });

  t.after(() => server.close());

  const response = await fetch(
    `${server.baseUrl}/api/provider/services/88`,
    { method: 'DELETE' }
  );

  const result = await response.json();

  assert.equal(response.status, 409);
  assert.equal(
    result.error,
    'This service has booking history and cannot be deleted.'
  );
});

// 12
test('provider availability changes are ownership-scoped', async (t) => {
  const calls = [];

  const pool = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      const normalized = normalizeSql(sql);

      if (normalized.startsWith('SELECT approval_status FROM provider_profiles')) {
        return pgResult([{ approval_status: 'approved' }]);
      }

      if (normalized.startsWith('UPDATE services')) {
        return pgResult([], 1);
      }

      throw new Error('Unexpected SQL in test: ' + sql);
    }
  };

  const server = await startServer((app) => {
    app.use(providerApp(pool));
  });

  t.after(() => server.close());

  const response = await fetch(
    `${server.baseUrl}/api/provider/services/88/availability`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isAvailable: true })
    }
  );

  const result = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(result.service, { id: 88, isAvailable: true });
  assert.deepEqual(calls[1].values, [true, 88, 27]);
  assert.match(
    normalizeSql(calls[1].sql),
    /WHERE id = \$2 AND provider_id = \$3/
  );
});

// 13
test('customer role cannot access provider service management', async (t) => {
  let databaseCalled = false;

  const pool = {
    query: async () => {
      databaseCalled = true;
      return pgResult([]);
    }
  };

  const server = await startServer((app) => {
    app.use(providerApp(pool, 'customer'));
  });

  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/provider/services`);

  assert.equal(response.status, 403);
  assert.equal(databaseCalled, false);
});

// 14
test('only admins can approve or reject services', async (t) => {
  let databaseCalled = false;

  const pool = {
    query: async () => {
      databaseCalled = true;
      return pgResult([], 1);
    }
  };

  const server = await startServer((app) => {
    app.use(adminApp(pool, 'provider'));
  });

  t.after(() => server.close());

  const response = await fetch(
    `${server.baseUrl}/api/admin/services/88/approval`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalStatus: 'approved' })
    }
  );

  assert.equal(response.status, 403);
  assert.equal(databaseCalled, false);
});

// 15
test('admin can list provider profiles with a parameterized status filter', async (t) => {
  const calls = [];

  const pool = {
    query: async (sql, values) => {
      calls.push({ sql, values });

      if (normalizeSql(sql).startsWith('SELECT COUNT(*)')) {
        return pgResult([{ total: '1' }]);
      }

      return pgResult([{
        id: 27,
        fullName: 'Local Provider',
        businessName: 'Home Help',
        approvalStatus: 'pending'
      }]);
    }
  };

  const server = await startServer((app) => {
    app.use(adminApp(pool));
  });

  t.after(() => server.close());

  const response = await fetch(
    `${server.baseUrl}/api/admin/providers?status=pending`
  );

  const result = await response.json();
  const listCall = calls.find(
    (call) => normalizeSql(call.sql).startsWith('SELECT u.id')
  );

  assert.equal(response.status, 200);
  assert.equal(result.providers[0].approvalStatus, 'pending');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].values, ['pending']);
  assert.deepEqual(listCall.values, ['pending', 10, 0]);
  assert.match(normalizeSql(listCall.sql), /u\.role = 'provider'/);
  assert.match(normalizeSql(listCall.sql), /p\.approval_status = \$1/);
});

// 16
test('admin service review queue includes listing locations', async (t) => {
  const calls = [];

  const pool = {
    query: async (sql, values) => {
      calls.push({ sql, values });

      if (normalizeSql(sql).startsWith('SELECT COUNT(*)')) {
        return pgResult([{ total: '1' }]);
      }

      return pgResult([{
        id: 55,
        serviceName: 'Home cleaning',
        location: 'Kothrud, Pune',
        approvalStatus: 'pending'
      }]);
    }
  };

  const server = await startServer((app) => {
    app.use(adminApp(pool));
  });

  t.after(() => server.close());

  const response = await fetch(
    `${server.baseUrl}/api/admin/services?status=pending`
  );

  const result = await response.json();
  const listCall = calls[1];

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.match(listCall.sql, /s\.location/);
  assert.deepEqual(calls[0].values, ['pending']);
  assert.deepEqual(listCall.values, ['pending', 10, 0]);
  assert.equal(result.services[0].location, 'Kothrud, Pune');
});

// 17
test('admin approval updates only the selected provider profile', async (t) => {
  const clientCalls = [];
  const poolCalls = [];

  const client = {
    query: async (sql, values) => {
      clientCalls.push({ sql, values });
      const normalized = normalizeSql(sql);

      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return pgResult([]);
      }

      if (normalized.startsWith('SELECT p.user_id')) {
        return pgResult([{ user_id: 27 }]);
      }

      if (normalized.startsWith('UPDATE provider_profiles')) {
        return pgResult([], 1);
      }

      if (normalized.startsWith('INSERT INTO admin_audit_log')) {
        return pgResult([], 1);
      }

      throw new Error('Unexpected client SQL in test: ' + sql);
    },
    release: () => {}
  };

  const pool = {
    connect: async () => client,
    query: async (sql, values) => {
      poolCalls.push({ sql, values });
      throw new Error('Unexpected pool query in transaction test: ' + sql);
    }
  };

  const server = await startServer((app) => {
    app.use(adminApp(pool));
  });

  t.after(() => server.close());

  const response = await fetch(
    `${server.baseUrl}/api/admin/providers/27/approve`,
    {
      method: 'PATCH'
    }
  );

  const result = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(result.provider, {
    userId: 27,
    approvalStatus: 'approved'
  });

  const updateCall = clientCalls.find(
    (call) => normalizeSql(call.sql).startsWith('UPDATE provider_profiles')
  );

  assert.deepEqual(updateCall.values, [27]);
  assert.match(
    normalizeSql(updateCall.sql),
    /SET approval_status = 'approved' WHERE user_id = \$1/
  );

  assert.ok(
    clientCalls.some((call) =>
      normalizeSql(call.sql).startsWith('INSERT INTO admin_audit_log')
    )
  );

  assert.equal(poolCalls.length, 0);
});

// 18
test('non-admin cannot access provider approval APIs', async (t) => {
  let databaseCalled = false;

  const pool = {
    query: async () => {
      databaseCalled = true;
      return pgResult([]);
    }
  };

  const server = await startServer((app) => {
    app.use(adminApp(pool, 'provider'));
  });

  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/admin/providers`);

  assert.equal(response.status, 403);
  assert.equal(databaseCalled, false);
});
