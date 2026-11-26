
require('dotenv').config({
  path: require('path').join(__dirname, '.env'),
  override: false
});

const crypto = require('crypto');
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

const app = express();
const port = Number(process.env.PORT || 3000);
const frontendPath = path.join(__dirname, '..', 'frontend');
const isProduction = process.env.NODE_ENV === 'production';
const sessionCookieName = 'pune_seva.sid';
let sessionSecret = process.env.SESSION_SECRET;
const adminLoginPath = process.env.ADMIN_LOGIN_PATH || (isProduction ? '' : '/admin-access');
const reservedAdminLoginPaths = new Set([
  '/admin-login.html',
  '/admin-dashboard.html',
  '/customer-dashboard.html',
  '/provider-dashboard.html',
  '/login.html',
  '/register.html',
  '/provider-register.html'
]);

const isPlaceholderSessionSecret = /^(?:replace|your|change(?:me)?|example|placeholder)[_-]/i.test(sessionSecret || '');
if (isProduction && (!sessionSecret || sessionSecret.length < 32 || isPlaceholderSessionSecret)) {
  throw new Error('Set SESSION_SECRET to a random value of at least 32 characters before running in production.');
}
if (!adminLoginPath || !/^\/[A-Za-z0-9_-]+$/.test(adminLoginPath) ||
    reservedAdminLoginPaths.has(adminLoginPath) || (isProduction && adminLoginPath.length < 24)) {
  throw new Error('Set ADMIN_LOGIN_PATH to a private absolute path (at least 24 characters in production).');
}
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(48).toString('hex');
  console.warn('SESSION_SECRET is not set; using an ephemeral development key. Add a persistent secret to backend/.env.');
}

app.disable('x-powered-by');
if (isProduction) app.set('trust proxy', 1);

app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !req.headers.origin) return next();
  try {
    const requestOrigin = new URL(req.headers.origin);
    const expectedOrigin = `${req.protocol}://${req.get('host')}`;
    if (requestOrigin.origin !== expectedOrigin) {
      return res.status(403).json({ error: 'Requests must come from this site.' });
    }
  } catch {
    return res.status(403).json({ error: 'Invalid request origin.' });
  }
  next();
});

app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

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

async function startServer() {
  await checkDatabaseConnection();
  const schema = await loadAuthSchema(pool);
  await ensureContactMessagesTable(pool);

  const sessionStore = new PostgreSQLSessionStore(pool);
  await sessionStore.initialize();

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

  app.get(adminLoginPath, (req, res) => res.sendFile(path.join(frontendPath, 'admin-login.html')));
  app.get('/admin-login.html', (req, res) => res.sendStatus(404));
  app.use(adminLoginPath, createAdminLoginRouter({ pool, schema }));
  app.use('/api/auth', createAuthRouter({ pool, schema, sessionCookieName }));
  app.use('/api/contact', createContactRouter({ pool }));

  const requireUser = requireAuth(pool, schema);
  app.use('/api/services', createServicesRouter({ pool, schema }));
  app.use('/api/customer', requireUser, requireRole('customer'), createCustomerRouter({ pool, schema }));
  app.use('/api/provider', requireUser, requireRole('provider'), createProviderRouter({ pool, schema }));
  app.use('/api/admin', requireUser, requireRole('admin'), createAdminRouter({ pool, schema }));

  app.use('/uploads', (req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  }, express.static(path.join(__dirname, 'uploads'), {
    dotfiles: 'deny',
    index: false,
    maxAge: isProduction ? '1d' : 0
  }));

  const dashboardFile = (fileName) => (req, res) => res.sendFile(path.join(frontendPath, fileName));
  app.get('/customer-dashboard.html', requireUser, requireRole('customer'), dashboardFile('customer-dashboard.html'));
  app.get('/provider-dashboard.html', requireUser, requireRole('provider'), dashboardFile('provider-dashboard.html'));
  app.get('/admin-dashboard.html', requireAuth(pool, schema, { loginPath: adminLoginPath }), requireRole('admin'), dashboardFile('admin-dashboard.html'));

  app.use(express.static(frontendPath));

  app.use((req, res) => {
    res.status(404).json({ error: 'Route not found.' });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error('Request failed:', error.message);
    const status = error.status || error.statusCode || 500;
    res.status(status).json({
      error: status < 500 ? 'The request could not be processed.' : 'The server could not complete the request.'
    });
  });

  const server = app.listen(port, () => {
    console.log(`Pune Seva server is running at http://localhost:${port}`);
  });

  server.on('error', (error) => {
    console.error(`Pune Seva could not listen on port ${port}:`, error.message);
    pool.end()
      .catch((closeError) => console.error('Database pool shutdown failed:', closeError.message))
      .finally(() => { process.exitCode = 1; });
  });
}

startServer().catch((error) => {
  console.error('Pune Seva could not start:', error.message);
  pool.end()
    .catch((closeError) => console.error('Database pool shutdown failed:', closeError.message))
    .finally(() => { process.exitCode = 1; });
});
