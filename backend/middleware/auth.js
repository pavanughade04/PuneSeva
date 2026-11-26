
function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

function isActiveCondition(schema, alias = '') {
  const prefix = alias ? `${alias}.` : '';

  return `${prefix}is_active = TRUE`;
}

function safeUser(row) {
  return {
    id: Number(row.id),
    fullName: row.full_name,
    email: row.email,
    role: row.role
  };
}

function requireAuth(pool, schema, { loginPath = '/login.html' } = {}) {
  return asyncHandler(async (req, res, next) => {
    if (!req.session?.user?.id) {
      if (!req.originalUrl.startsWith('/api/')) {
        return res.redirect(loginPath);
      }

      return res.status(401).json({
        error: 'Please log in to continue.'
      });
    }

    const result = await pool.query(
      `SELECT id, full_name, email, role
       FROM users
       WHERE id = $1 AND ${isActiveCondition(schema)}
       LIMIT 1`,
      [req.session.user.id]
    );

    if (result.rows.length === 0) {
      await new Promise((resolve, reject) => {
        req.session.destroy((error) =>
          error ? reject(error) : resolve()
        );
      });

      res.clearCookie('pune_seva.sid');

      if (!req.originalUrl.startsWith('/api/')) {
        return res.redirect(loginPath);
      }

      return res.status(401).json({
        error: 'Your session is no longer active. Please log in again.'
      });
    }

    req.user = safeUser(result.rows[0]);

    next();
  });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      if (!req.originalUrl.startsWith('/api/')) {
        const dashboardByRole = {
          customer: '/customer-dashboard.html',
          provider: '/provider-dashboard.html',
          admin: '/admin-dashboard.html'
        };

        if (req.user && dashboardByRole[req.user.role]) {
          return res.redirect(dashboardByRole[req.user.role]);
        }
      }

      return res.status(403).json({
        error: 'You do not have permission to access this resource.'
      });
    }

    next();
  };
}

module.exports = {
  asyncHandler,
  isActiveCondition,
  requireAuth,
  requireRole,
  safeUser
};
