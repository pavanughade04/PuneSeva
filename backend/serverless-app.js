
require('dotenv').config({
  path: require('path').join(__dirname, '.env'),
  override: true
});

const path = require('path');
const express = require('express');
const session = require('express-session');

const { checkDatabaseConnection, pool } = require('./config/db');
const { requireAuth, requireRole } = require('./middleware/auth');
const { createAdminLoginRouter, createAuthRouter } = require('./routes/auth');
const { createCustomerRouter } = require('./routes/customer');
const { createProviderRouter } = require('./routes/provider');
const { createAdminRouter } = require('./routes/admin');
const { createServicesRouter } = require('./routes/services');
const { loadAuthSchema } = require('./services/auth-schema');
const { PostgreSQLSessionStore } = require('./services/postgres-session-store')
const { ensureContactMessagesTable } = require('./services/contact-schema');
const { createContactRouter } = require('./routes/contact');

async function createApp() {
  const app = express();

  const frontendPath = path.resolve(process.cwd(), 'frontend');
  const isProduction = process.env.NODE_ENV === 'production';
  const sessionCookieName = 'pune_seva.sid';

  const sessionSecret = process.env.SESSION_SECRET;
  const adminLoginPath = process.env.ADMIN_LOGIN_PATH || '';

  if (
    !sessionSecret ||
    sessionSecret.length < 32 ||
    /^(?:replace|your|change(?:me)?|example|placeholder)[\_-]/i.test(sessionSecret)
  ) {
    throw new Error('A secure SESSION_SECRET of at least 32 characters is required.');
  }

  if (
    !adminLoginPath ||
    !/^\/[A-Za-z0-9_-]+$/.test(adminLoginPath) ||
    adminLoginPath.length < 24
  ) {
    throw new Error('A valid private ADMIN_LOGIN_PATH is required.');
  }

  await checkDatabaseConnection();

  const schema = await loadAuthSchema(pool);
  await ensureContactMessagesTable(pool);

  const sessionStore = new PostgreSQLSessionStore(pool);
  await sessionStore.initialize({ serverless: true });

  app.disable('x-powered-by');

  if (isProduction) {
    app.set('trust proxy', 1);
  }

  app.use(express.json({ limit: '20kb' }));
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));

  app.use(session({
    name: sessionCookieName,
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000
    }
  }));

  app.get('/api/health', async (req, res, next) => {
    try {
      await checkDatabaseConnection();

      res.json({
        status: 'ok',
        database: 'connected',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  });

  app.get(adminLoginPath, (req, res) => {
    res.sendFile(path.join(frontendPath, 'admin-login.html'));
  });

  app.get('/admin-login.html', (req, res) => res.sendStatus(404));

  app.use(adminLoginPath, createAdminLoginRouter({ pool, schema }));
  app.use('/api/auth', createAuthRouter({ pool, schema, sessionCookieName }));
  app.use('/api/contact', createContactRouter({ pool }));

  const requireUser = requireAuth(pool, schema);

  app.use('/api/services', createServicesRouter({ pool, schema }));

  app.use(
    '/api/customer',
    requireUser,
    requireRole('customer'),
    createCustomerRouter({ pool, schema })
  );

  app.use(
    '/api/provider',
    requireUser,
    requireRole('provider'),
    createProviderRouter({ pool, schema })
  );

  app.use(
    '/api/admin',
    requireUser,
    requireRole('admin'),
    createAdminRouter({ pool, schema })
  );

  const dashboardFile = (fileName) => (req, res) => {
    res.sendFile(path.join(frontendPath, fileName));
  };

  app.get(
    '/customer-dashboard.html',
    requireUser,
    requireRole('customer'),
    dashboardFile('customer-dashboard.html')
  );

  app.get(
    '/provider-dashboard.html',
    requireUser,
    requireRole('provider'),
    dashboardFile('provider-dashboard.html')
  );

  app.get(
    '/admin-dashboard.html',
    requireAuth(pool, schema, { loginPath: adminLoginPath }),
    requireRole('admin'),
    dashboardFile('admin-dashboard.html')
  );

  // Serve frontend files
  app.use(express.static(frontendPath));

  app.use((req, res) => {
    res.status(404).json({ error: 'Route not found.' });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    console.error('Request failed:', error.message);

    const status = error.status || error.statusCode || 500;

    res.status(status).json({
      error: status < 500
        ? 'The request could not be processed.'
        : 'The server could not complete the request.'
    });
  });

  return app;
}

module.exports = { createApp };
