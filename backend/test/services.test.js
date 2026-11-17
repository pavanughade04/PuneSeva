const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { after, test } = require('node:test');
const express = require('express');
const { requireRole } = require('../middleware/auth');
const { createAdminRouter } = require('../routes/admin');
const { createProviderRouter } = require('../routes/provider');
const { createServicesRouter } = require('../routes/services');
const { removeServiceImage } = require('../middleware/service-image-upload');

const schema = {
  users: new Set(['account_status'])
};

async function startServer(configure) {
  const app = express();
  app.use(express.json());
  configure(app);
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

function providerApp(pool, role = 'provider') {
  const app = express();
  app.use(express.json());
  app.use('/api/provider', (req, res, next) => {
    req.user = { id: 27, role };
    next();
  }, requireRole('provider'), createProviderRouter({ pool }));
  return app;
}

function adminApp(pool, role = 'admin') {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', (req, res, next) => {
    req.user = { id: 9, role };
    next();
  }, requireRole('admin'), createAdminRouter({ pool }));
  return app;
}

test('public services page is served by the frontend static route', async (t) => {
  const frontendPath = path.join(__dirname, '..', '..', 'frontend');
  const server = await startServer((app) => app.use(express.static(frontendPath)));
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/services.html`);
  const page = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(page, /id="catalog-filters"/);
  assert.match(page, /src="\/js\/services\.js"/);
});

test('public search only queries approved, available services and returns JSON', async (t) => {
  let executed;
  const pool = {
    execute: async (sql, values) => {
      executed = { sql, values };
      return [[{
        id: 3,
        serviceName: 'House cleaning',
        category: 'Cleaning',
        image: '/uploads/cleaning.png',
        isAvailable: 1,
        createdAt: '2026-01-01T00:00:00.000Z'
      }], []];
    }
  };
  const server = await startServer((app) => {
    app.use('/api/services', createServicesRouter({ pool, schema }));
  });
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/services?search=clean&category=Cleaning&location=Kothrud&sort=price_asc`);
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type').includes('application/json'), true);
  assert.match(executed.sql, /s\.approval_status = \?/);
  assert.match(executed.sql, /s\.is_available = 1/);
  assert.match(executed.sql, /p\.approval_status = \?/);
  assert.match(executed.sql, /s\.location LIKE \?/);
  assert.match(executed.sql, /ORDER BY s\.price ASC, s\.id ASC/);
  assert.ok(executed.values.includes('Cleaning'));
  assert.ok(executed.values.includes('%Kothrud%'));
  assert.ok(executed.values.includes('%clean%'));
  assert.equal(result.services[0].isAvailable, true);
  assert.equal(result.services[0].image, '/uploads/cleaning.png');
});

test('public service details hide unavailable and unapproved listings', async (t) => {
  let executed;
  const pool = {
    execute: async (sql, values) => {
      executed = { sql, values };
      return [[], []];
    }
  };
  const server = await startServer((app) => {
    app.use('/api/services', createServicesRouter({ pool, schema }));
  });
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/services/41`);
  const result = await response.json();

  assert.equal(response.status, 404);
  assert.equal(result.error, 'Service not found.');
  assert.match(executed.sql, /s\.approval_status = \?/);
  assert.match(executed.sql, /s\.is_available = 1/);
  assert.deepEqual(executed.values, [41, 'approved', 'approved']);
});

test('provider-created services are pending and tied to the session provider', async (t) => {
  const calls = [];
  const pool = {
    execute: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes('SELECT approval_status FROM provider_profiles')) {
        return [[{ approval_status: 'approved' }], []];
      }
      if (sql.includes('INSERT INTO services')) return [{ insertId: 55, affectedRows: 1 }, []];
      throw new Error('Unexpected SQL in test: ' + sql);
    }
  };
  const server = await startServer((app) => {
    app.use('/api/provider', (req, res, next) => {
      req.user = { id: 27, role: 'provider' };
      next();
    }, requireRole('provider'), createProviderRouter({ pool }));
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
  assert.equal(calls[1].values[0], 27);
  assert.ok(calls[1].values.includes('Kothrud, Pune'));
  assert.match(calls[1].sql, /'pending'/);
});

test('provider can upload a validated image with a service', async (t) => {
  const calls = [];
  const pool = {
    execute: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes('SELECT approval_status FROM provider_profiles')) {
        return [[{ approval_status: 'approved' }], []];
      }
      if (sql.includes('INSERT INTO services')) return [{ insertId: 56, affectedRows: 1 }, []];
      throw new Error('Unexpected SQL in test: ' + sql);
    }
  };
  const server = await startServer((app) => {
    app.use('/api/provider', (req, res, next) => {
      req.user = { id: 27, role: 'provider' };
      next();
    }, requireRole('provider'), createProviderRouter({ pool }));
  });
  t.after(() => server.close());

  const form = new FormData();
  form.append('serviceName', 'Home cleaning');
  form.append('category', 'Cleaning');
  form.append('description', 'Cleaning for apartments and houses.');
  form.append('location', 'Kothrud, Pune');
  form.append('price', '500');
  form.append('priceType', 'fixed');
  form.append('isAvailable', 'true');
  form.append('image', new Blob([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ], { type: 'image/png' }), 'service.png');

  const response = await fetch(`${server.baseUrl}/api/provider/services`, {
    method: 'POST',
    body: form
  });
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.match(result.service.image, /^\/uploads\/[0-9a-f-]{36}\.png$/);
  assert.ok(calls[1].values.includes(result.service.image));
  const filename = result.service.image.split('/').pop();
  try {
    const stored = await fs.readFile(require('node:path').join(__dirname, '..', 'uploads', filename));
    assert.deepEqual(stored, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  } finally {
    await removeServiceImage(filename);
  }
});

test('provider image upload rejects content that does not match its image type', async (t) => {
  let databaseCalled = false;
  const pool = {
    execute: async () => {
      databaseCalled = true;
      return [[{ approval_status: 'approved' }], []];
    }
  };
  const server = await startServer((app) => {
    app.use('/api/provider', (req, res, next) => {
      req.user = { id: 27, role: 'provider' };
      next();
    }, requireRole('provider'), createProviderRouter({ pool }));
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

test('provider service list is scoped to the signed-in provider', async (t) => {
  let executed;
  const pool = {
    execute: async (sql, values) => {
      executed = { sql, values };
      return [[{
        id: 55,
        serviceName: 'Home cleaning',
        location: 'Kothrud, Pune',
        isAvailable: 1,
        approvalStatus: 'approved'
      }], []];
    }
  };
  const server = await startServer((app) => app.use(providerApp(pool)));
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/provider/services`);
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(executed.values, [27]);
  assert.match(executed.sql, /WHERE provider_id = \?/);
  assert.equal(result.services[0].location, 'Kothrud, Pune');
  assert.equal(result.services[0].isAvailable, true);
});

test('provider cannot edit another provider service', async (t) => {
  const calls = [];
  const pool = {
    execute: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes('SELECT approval_status FROM provider_profiles')) {
        return [[{ approval_status: 'approved' }], []];
      }
      if (sql.startsWith('SELECT image FROM services')) return [[], []];
      if (sql.startsWith('UPDATE services')) return [{ affectedRows: 0 }, []];
      if (sql.includes('SELECT id FROM services')) return [[], []];
      throw new Error('Unexpected SQL in test: ' + sql);
    }
  };
  const server = await startServer((app) => app.use(providerApp(pool)));
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
  assert.ok(calls[1].values.includes(27));
  assert.match(calls[1].sql, /WHERE id = \? AND provider_id = \?/);
});

test('provider edits reset service approval and save its location', async (t) => {
  const calls = [];
  const pool = {
    execute: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes('SELECT approval_status FROM provider_profiles')) {
        return [[{ approval_status: 'approved' }], []];
      }
      if (sql.startsWith('SELECT image FROM services')) return [[{ image: null }], []];
      if (sql.startsWith('UPDATE services')) return [{ affectedRows: 1 }, []];
      if (sql.includes('FROM services') && sql.includes('WHERE id = ? AND provider_id = ?')) {
        return [[{
          id: 88,
          serviceName: 'Home cleaning',
          location: 'Baner, Pune',
          isAvailable: 1,
          approvalStatus: 'pending'
        }], []];
      }
      throw new Error('Unexpected SQL in test: ' + sql);
    }
  };
  const server = await startServer((app) => app.use(providerApp(pool)));
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

test('provider service validation rejects missing locations before database access', async (t) => {
  let databaseCalled = false;
  const pool = {
    execute: async () => {
      databaseCalled = true;
      return [[], []];
    }
  };
  const server = await startServer((app) => app.use(providerApp(pool)));
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

test('service with booking history cannot be deleted', async (t) => {
  const pool = {
    execute: async () => {
      const error = new Error('Foreign key constraint');
      error.code = 'ER_ROW_IS_REFERENCED_2';
      throw error;
    }
  };
  const server = await startServer((app) => app.use(providerApp(pool)));
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/provider/services/88`, { method: 'DELETE' });
  const result = await response.json();
  assert.equal(response.status, 409);
  assert.equal(result.error, 'This service has booking history and cannot be deleted.');
});

test('provider availability changes are ownership-scoped', async (t) => {
  const calls = [];
  const pool = {
    execute: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes('SELECT approval_status FROM provider_profiles')) {
        return [[{ approval_status: 'approved' }], []];
      }
      if (sql.startsWith('UPDATE services')) return [{ affectedRows: 1 }, []];
      throw new Error('Unexpected SQL in test: ' + sql);
    }
  };
  const server = await startServer((app) => {
    app.use('/api/provider', (req, res, next) => {
      req.user = { id: 27, role: 'provider' };
      next();
    }, requireRole('provider'), createProviderRouter({ pool }));
  });
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/provider/services/88/availability`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isAvailable: true })
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(result.service, { id: 88, isAvailable: true });
  assert.deepEqual(calls[1].values, [1, 88, 27]);
  assert.match(calls[1].sql, /WHERE id = \? AND provider_id = \?/);
});

test('customer role cannot access provider service management', async (t) => {
  let databaseCalled = false;
  const pool = {
    execute: async () => {
      databaseCalled = true;
      return [[], []];
    }
  };
  const server = await startServer((app) => {
    app.use('/api/provider', (req, res, next) => {
      req.user = { id: 27, role: 'customer' };
      next();
    }, requireRole('provider'), createProviderRouter({ pool }));
  });
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/provider/services`);
  assert.equal(response.status, 403);
  assert.equal(databaseCalled, false);
});

test('only admins can approve or reject services', async (t) => {
  let databaseCalled = false;
  const pool = {
    execute: async () => {
      databaseCalled = true;
      return [{ affectedRows: 1 }, []];
    }
  };
  const server = await startServer((app) => {
    app.use('/api/admin', (req, res, next) => {
      req.user = { id: 27, role: 'provider' };
      next();
    }, requireRole('admin'), createAdminRouter({ pool }));
  });
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/admin/services/88/approval`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approvalStatus: 'approved' })
  });
  assert.equal(response.status, 403);
  assert.equal(databaseCalled, false);
});

test('admin can list provider profiles with a parameterized status filter', async (t) => {
  let executed;
  const pool = {
    execute: async (sql, values) => {
      executed = { sql, values };
      return [[{
        providerId: 27,
        fullName: 'Local Provider',
        businessName: 'Home Help',
        approvalStatus: 'pending'
      }], []];
    }
  };
  const server = await startServer((app) => app.use(adminApp(pool)));
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/admin/providers?status=pending`);
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.providers[0].approvalStatus, 'pending');
  assert.match(executed.sql, /WHERE u\.role = \?\s+AND p\.approval_status = \?/);
  assert.deepEqual(executed.values, ['provider', 'pending']);
});

test('admin service review queue includes listing locations', async (t) => {
  let executed;
  const pool = {
    execute: async (sql, values) => {
      executed = { sql, values };
      return [[{
        id: 55,
        serviceName: 'Home cleaning',
        location: 'Kothrud, Pune',
        approvalStatus: 'pending'
      }], []];
    }
  };
  const server = await startServer((app) => app.use(adminApp(pool)));
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/admin/services`);
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.match(executed.sql, /s\.location/);
  assert.deepEqual(executed.values, ['pending']);
  assert.equal(result.services[0].location, 'Kothrud, Pune');
});

test('admin approval updates only the selected provider profile', async (t) => {
  let executed;
  const pool = {
    execute: async (sql, values) => {
      executed = { sql, values };
      return [{ affectedRows: 1 }, []];
    }
  };
  const server = await startServer((app) => app.use(adminApp(pool)));
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/admin/providers/27/approval`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approvalStatus: 'approved' })
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(result.provider, { id: 27, approvalStatus: 'approved' });
  assert.deepEqual(executed.values, ['approved', 27, 'provider']);
  assert.match(executed.sql, /WHERE p\.user_id = \? AND u\.role = \?/);
});

test('non-admin cannot access provider approval APIs', async (t) => {
  let databaseCalled = false;
  const pool = {
    execute: async () => {
      databaseCalled = true;
      return [[], []];
    }
  };
  const server = await startServer((app) => app.use(adminApp(pool, 'provider')));
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/admin/providers`);
  assert.equal(response.status, 403);
  assert.equal(databaseCalled, false);
});
