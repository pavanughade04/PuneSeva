const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { asyncHandler } = require('../middleware/auth');

function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  return res.status(400).json({
    error: 'Please check the provided information.',
    details: errors.array({ onlyFirstError: true }).map(({ path, msg }) => ({ field: path, message: msg }))
  });
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPositiveInt(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

async function tableExists(pool, tableName) {
  const [rows] = await pool.execute(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1',
    [tableName]
  );
  return rows.length > 0;
}

function buildPagination(page, limit, total) {
  const safePage = Math.max(1, toPositiveInt(page, 1));
  const safeLimit = Math.max(1, Math.min(100, toPositiveInt(limit, 20)));
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  return {
    page: safePage,
    limit: safeLimit,
    total,
    totalPages,
    hasNextPage: safePage < totalPages
  };
}

function getUserStatusColumn(schema, alias = 'u') {
  return schema?.users?.has('account_status') ? `${alias}.account_status` : `${alias}.is_active`;
}

function normalizeUserStatus(schema, status) {
  if (schema?.users?.has('account_status')) return status;
  return status === 'active' ? 1 : 0;
}

function getUserStatusSql(schema, alias = 'u') {
  if (schema?.users?.has('account_status')) {
    return `${alias}.account_status`;
  }
  return `CASE WHEN ${alias}.is_active = 1 THEN 'active' ELSE 'blocked' END`;
}

function getUserStatusExpression(schema, alias = 'u', status = 'active') {
  if (schema?.users?.has('account_status')) {
    return `${alias}.account_status = '${status}'`;
  }
  return status === 'active' ? `${alias}.is_active = 1` : `${alias}.is_active = 0`;
}

async function withTransaction(pool, action) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await action(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function writeAuditLog(connection, adminId, entityType, entityId, action, reason = null) {
  await connection.execute(
    `INSERT INTO admin_audit_log (admin_id, entity_type, entity_id, action, reason)
     VALUES (?, ?, ?, ?, ?)`,
    [adminId, entityType, entityId, action, reason]
  );
}

function createAdminRouter({ pool, schema = { users: new Set(['account_status']) } }) {
  const router = express.Router();
  const providerExperienceColumn = `p.${schema.experienceColumn || 'experience_years'}`;
  const providerAreaColumn = `p.${schema.areaColumn || 'service_area'}`;
  const providerDescriptionColumn = `p.${schema.descriptionColumn || 'description'}`;
  const providerAddressColumn = schema.providers?.has('address') === false ? 'NULL' : 'p.address';
  const providerCityColumn = schema.providers?.has('city') === false ? 'NULL' : 'p.city';
  const userPhoneColumn = schema.users?.has('phone') === false ? 'NULL' : 'u.phone';
  const serviceImageColumn = schema.services?.has('image') === false ? 'NULL' : 's.image';
  const servicePriceTypeColumn = schema.services?.has('price_type') === false ? "'fixed'" : 's.price_type';

  router.get('/dashboard', asyncHandler(async (req, res) => {
    const [serviceRows] = await pool.execute(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(approval_status = 'pending'), 0) AS pending,
         COALESCE(SUM(approval_status = 'approved'), 0) AS approved,
         COALESCE(SUM(approval_status = 'rejected'), 0) AS rejected
       FROM services`
    );
    const [providerRows] = await pool.execute(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(approval_status = 'pending'), 0) AS pending,
         COALESCE(SUM(approval_status = 'approved'), 0) AS approved,
         COALESCE(SUM(approval_status = 'rejected'), 0) AS rejected
       FROM provider_profiles`
    );
    res.json({
      services: Object.fromEntries(
        Object.entries(serviceRows[0]).map(([key, value]) => [key, Number(value)])
      ),
      providers: Object.fromEntries(
        Object.entries(providerRows[0]).map(([key, value]) => [key, Number(value)])
      )
    });
  }));

  router.get('/dashboard/stats', asyncHandler(async (req, res) => {
    const customerActive = getUserStatusExpression(schema, 'users', 'active');
    const customerBlocked = getUserStatusExpression(schema, 'users', 'blocked');
    const providerActive = getUserStatusExpression(schema, 'u', 'active');
    const providerBlocked = getUserStatusExpression(schema, 'u', 'blocked');

    const [customerRows] = await pool.execute(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(${customerActive}), 0) AS active,
         COALESCE(SUM(${customerBlocked}), 0) AS blocked
       FROM users WHERE role = 'customer'`
    );
    const [providerRows] = await pool.execute(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(approval_status = 'pending'), 0) AS pending,
         COALESCE(SUM(approval_status = 'approved'), 0) AS approved,
         COALESCE(SUM(approval_status = 'rejected'), 0) AS rejected,
         COALESCE(SUM(${providerActive}), 0) AS active,
         COALESCE(SUM(${providerBlocked}), 0) AS blocked
       FROM provider_profiles AS p
       JOIN users AS u ON u.id = p.user_id`
    );
    const [serviceRows] = await pool.execute(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(approval_status = 'pending'), 0) AS pending,
         COALESCE(SUM(approval_status = 'approved'), 0) AS approved,
         COALESCE(SUM(approval_status = 'rejected'), 0) AS rejected,
         COALESCE(SUM(is_available = 1), 0) AS active
       FROM services`
    );
    const [bookingRows] = await pool.execute(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(status = 'pending'), 0) AS pending,
         COALESCE(SUM(status = 'accepted'), 0) AS accepted,
         COALESCE(SUM(status = 'cancelled'), 0) AS cancelled,
         COALESCE(SUM(status = 'completed'), 0) AS completed,
         COALESCE(SUM(status = 'in_progress'), 0) AS inProgress
       FROM bookings`
    );
    let reviewRows = [{ total: 0 }];
    if (await tableExists(pool, 'reviews')) {
      [reviewRows] = await pool.execute('SELECT COUNT(*) AS total FROM reviews');
    }

    const stats = {
      customers: {
        total: Number(customerRows[0].total || 0),
        active: Number(customerRows[0].active || 0),
        blocked: Number(customerRows[0].blocked || 0)
      },
      providers: {
        total: Number(providerRows[0].total || 0),
        pending: Number(providerRows[0].pending || 0),
        approved: Number(providerRows[0].approved || 0),
        rejected: Number(providerRows[0].rejected || 0),
        active: Number(providerRows[0].active || 0),
        blocked: Number(providerRows[0].blocked || 0)
      },
      services: {
        total: Number(serviceRows[0].total || 0),
        pending: Number(serviceRows[0].pending || 0),
        approved: Number(serviceRows[0].approved || 0),
        rejected: Number(serviceRows[0].rejected || 0),
        active: Number(serviceRows[0].active || 0)
      },
      bookings: {
        total: Number(bookingRows[0].total || 0),
        pending: Number(bookingRows[0].pending || 0),
        accepted: Number(bookingRows[0].accepted || 0),
        cancelled: Number(bookingRows[0].cancelled || 0),
        completed: Number(bookingRows[0].completed || 0),
        inProgress: Number(bookingRows[0].inProgress || 0)
      },
      reviews: {
        total: Number(reviewRows[0].total || 0)
      }
    };

    const [recentBookings] = await pool.execute(
      `SELECT
         b.id,
         b.status,
         b.total_amount AS totalAmount,
         b.created_at AS createdAt,
         customer.full_name AS customerName,
         provider.full_name AS providerName,
         s.service_name AS serviceName
       FROM bookings AS b
       JOIN users AS customer ON customer.id = b.customer_id
       JOIN users AS provider ON provider.id = b.provider_id
       JOIN services AS s ON s.id = b.service_id
       ORDER BY b.created_at DESC
       LIMIT 5`
    );

    const [recentProviders] = await pool.execute(
      `SELECT
         u.id,
         u.full_name AS fullName,
         p.business_name AS businessName,
         p.created_at AS createdAt,
         p.approval_status AS approvalStatus
       FROM users AS u
       JOIN provider_profiles AS p ON p.user_id = u.id
       WHERE u.role = 'provider'
       ORDER BY p.created_at DESC
       LIMIT 5`
    );

    const [recentServices] = await pool.execute(
      `SELECT
         s.id,
         s.service_name AS serviceName,
         s.category,
         s.price,
         s.approval_status AS approvalStatus,
         s.created_at AS createdAt,
         provider.full_name AS providerName
       FROM services AS s
       JOIN users AS provider ON provider.id = s.provider_id
       ORDER BY s.created_at DESC
       LIMIT 5`
    );

    res.json({
      stats,
      recentActivity: {
        recentBookings: recentBookings.map((row) => ({
          ...row,
          totalAmount: Number(row.totalAmount || 0),
          createdAt: row.createdAt
        })),
        recentProviders: recentProviders.map((row) => ({ ...row, createdAt: row.createdAt })),
        recentServices: recentServices.map((row) => ({ ...row, price: Number(row.price || 0), createdAt: row.createdAt }))
      }
    });
  }));

  router.get('/dashboard/recent-activity', asyncHandler(async (req, res) => {
    const [recentBookings] = await pool.execute(
      `SELECT
         b.id,
         b.status,
         b.total_amount AS totalAmount,
         b.created_at AS createdAt,
         customer.full_name AS customerName,
         provider.full_name AS providerName,
         s.service_name AS serviceName
       FROM bookings AS b
       JOIN users AS customer ON customer.id = b.customer_id
       JOIN users AS provider ON provider.id = b.provider_id
       JOIN services AS s ON s.id = b.service_id
       ORDER BY b.created_at DESC
       LIMIT 5`
    );

    const [recentProviders] = await pool.execute(
      `SELECT
         u.id,
         u.full_name AS fullName,
         p.business_name AS businessName,
         p.created_at AS createdAt,
         p.approval_status AS approvalStatus
       FROM users AS u
       JOIN provider_profiles AS p ON p.user_id = u.id
       WHERE u.role = 'provider'
       ORDER BY p.created_at DESC
       LIMIT 5`
    );

    const [recentServices] = await pool.execute(
      `SELECT
         s.id,
         s.service_name AS serviceName,
         s.category,
         s.price,
         s.approval_status AS approvalStatus,
         s.created_at AS createdAt,
         provider.full_name AS providerName
       FROM services AS s
       JOIN users AS provider ON provider.id = s.provider_id
       ORDER BY s.created_at DESC
       LIMIT 5`
    );

    res.json({
      recentBookings: recentBookings.map((row) => ({
        ...row,
        totalAmount: Number(row.totalAmount || 0),
        createdAt: row.createdAt
      })),
      recentProviders: recentProviders.map((row) => ({ ...row, createdAt: row.createdAt })),
      recentServices: recentServices.map((row) => ({ ...row, price: Number(row.price || 0), createdAt: row.createdAt }))
    });
  }));

  router.get('/customers', [
    query('status').optional().isIn(['active', 'blocked', 'all']).withMessage('Choose active, blocked, or all.'),
    query('search').optional().trim().isLength({ max: 100 }).withMessage('Search text cannot exceed 100 characters.'),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const search = (req.query.search || '').trim();
    const status = req.query.status || 'all';
    const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
    const page = hasPagination ? toPositiveInt(req.query.page, 1) : 1;
    const limit = hasPagination ? Math.min(100, toPositiveInt(req.query.limit, 20)) : 20;

    const filters = ['u.role = ?'];
    const values = ['customer'];

    if (status !== 'all') {
      filters.push(`${getUserStatusSql(schema, 'u')} = ?`);
      values.push(status);
    }

    if (search) {
      filters.push(`(u.full_name LIKE ? OR u.email LIKE ? OR ${userPhoneColumn} LIKE ?)`);
      const term = `%${search}%`;
      values.push(term, term, term);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM users AS u ${whereClause}`,
      values
    );
    const total = Number(countRows[0].total || 0);
    const pagination = buildPagination(page, limit, total);

    const sql = hasPagination
      ? `SELECT
         u.id AS customerId,
         u.full_name AS fullName,
         u.email,
         ${userPhoneColumn} AS phone,
         ${getUserStatusSql(schema, 'u')} AS accountStatus,
         u.created_at AS createdAt,
         COUNT(b.id) AS bookingCount
       FROM users AS u
       LEFT JOIN bookings AS b ON b.customer_id = u.id
       ${whereClause}
       GROUP BY u.id
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`
      : `SELECT
         u.id AS customerId,
         u.full_name AS fullName,
         u.email,
         ${userPhoneColumn} AS phone,
         ${getUserStatusSql(schema, 'u')} AS accountStatus,
         u.created_at AS createdAt,
         COUNT(b.id) AS bookingCount
       FROM users AS u
       LEFT JOIN bookings AS b ON b.customer_id = u.id
       ${whereClause}
       GROUP BY u.id
       ORDER BY u.created_at DESC`;

    const queryValues = hasPagination ? [...values, pagination.limit, (pagination.page - 1) * pagination.limit] : values;
    const [rows] = await pool.execute(sql, queryValues);

    res.json({
      customers: rows,
      pagination: hasPagination ? pagination : { page: 1, limit: rows.length || 0, total, totalPages: 1, hasNextPage: false }
    });
  }));

  router.get('/customers/:id', [
    param('id').isInt({ min: 1 }).withMessage('Customer ID must be a positive integer.').toInt(),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const [customerRows] = await pool.execute(
      `SELECT
         u.id AS customerId,
         u.full_name AS fullName,
         u.email,
         ${userPhoneColumn} AS phone,
         ${getUserStatusSql(schema, 'u')} AS accountStatus,
         u.created_at AS createdAt,
         cp.address,
         cp.area,
         cp.city
       FROM users AS u
       LEFT JOIN customer_profiles AS cp ON cp.user_id = u.id
       WHERE u.id = ? AND u.role = 'customer'
       LIMIT 1`,
      [req.params.id]
    );

    if (customerRows.length === 0) {
      return res.status(404).json({ error: 'Customer not found.' });
    }

    const [bookingRows] = await pool.execute(
      `SELECT
         b.id,
         b.booking_date AS bookingDate,
         b.booking_time AS bookingTime,
         b.status,
         b.total_amount AS totalAmount,
         b.created_at AS createdAt,
         s.service_name AS serviceName,
         provider.full_name AS providerName
       FROM bookings AS b
       JOIN services AS s ON s.id = b.service_id
       JOIN users AS provider ON provider.id = b.provider_id
       WHERE b.customer_id = ?
       ORDER BY b.created_at DESC
       LIMIT 10`,
      [req.params.id]
    );

    res.json({
      customer: customerRows[0],
      recentBookings: bookingRows
    });
  }));

  router.patch('/customers/:id/status', [
    param('id').isInt({ min: 1 }).withMessage('Customer ID must be a positive integer.').toInt(),
    body('status').isIn(['active', 'blocked']).withMessage('Use active or blocked.'),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const statusValue = normalizeUserStatus(schema, req.body.status);
    const updateSql = schema?.users?.has('account_status')
      ? 'UPDATE users SET account_status = ? WHERE id = ? AND role = ?'
      : 'UPDATE users SET is_active = ? WHERE id = ? AND role = ?';

    const [result] = await pool.execute(updateSql, [statusValue, req.params.id, 'customer']);

    if (result.affectedRows !== 1) {
      const [rows] = await pool.execute(
        'SELECT id FROM users WHERE id = ? AND role = ? LIMIT 1',
        [req.params.id, 'customer']
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Customer not found.' });
    }

    res.json({
      message: `Customer account ${req.body.status}.`,
      customer: { id: Number(req.params.id), accountStatus: req.body.status }
    });
  }));

  router.get('/providers', [
    query('status').optional().isIn(['pending', 'approved', 'rejected', 'all']).withMessage('Choose pending, approved, rejected, or all.'),
    query('accountStatus').optional().isIn(['active', 'blocked', 'all']).withMessage('Choose active, blocked, or all.'),
    query('search').optional().trim().isLength({ max: 100 }).withMessage('Search text cannot exceed 100 characters.'),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const status = req.query.status || 'pending';
    const accountStatus = req.query.accountStatus || 'all';
    const search = (req.query.search || '').trim();
    const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
    const page = hasPagination ? toPositiveInt(req.query.page, 1) : 1;
    const limit = hasPagination ? Math.min(100, toPositiveInt(req.query.limit, 20)) : 20;

    const filters = ['u.role = ?'];
    const values = ['provider'];
    if (status !== 'all') {
      filters.push('p.approval_status = ?');
      values.push(status);
    }
    if (accountStatus !== 'all') {
      filters.push(`${getUserStatusSql(schema, 'u')} = ?`);
      values.push(accountStatus);
    }
    if (search) {
      filters.push(`(u.full_name LIKE ? OR u.email LIKE ? OR p.business_name LIKE ? OR ${providerAreaColumn} LIKE ?)`);
      const term = `%${search}%`;
      values.push(term, term, term, term);
    }

    const whereClause = `WHERE ${filters.join(' AND ')}`;
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM users AS u
       JOIN provider_profiles AS p ON p.user_id = u.id
       ${whereClause}`,
      values
    );
    const total = Number(countRows[0].total || 0);
    const pagination = buildPagination(page, limit, total);

    const sql = hasPagination
      ? `SELECT
         p.user_id AS providerId,
         u.full_name AS fullName,
         u.email,
         ${userPhoneColumn} AS phone,
         ${getUserStatusSql(schema, 'u')} AS accountStatus,
         p.business_name AS businessName,
         ${providerExperienceColumn} AS experience,
         ${providerAreaColumn} AS serviceArea,
         ${providerDescriptionColumn} AS description,
         p.approval_status AS approvalStatus,
         CASE WHEN p.approval_status = 'rejected' THEN (
           SELECT audit.reason
           FROM admin_audit_log AS audit
           WHERE audit.entity_type = 'provider' AND audit.entity_id = p.user_id AND audit.action = 'rejected'
           ORDER BY audit.created_at DESC, audit.id DESC
           LIMIT 1
         ) ELSE NULL END AS rejectionReason,
         p.created_at AS createdAt
       FROM users AS u
       JOIN provider_profiles AS p ON p.user_id = u.id
       ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`
      : `SELECT
         p.user_id AS providerId,
         u.full_name AS fullName,
         u.email,
         ${userPhoneColumn} AS phone,
         ${getUserStatusSql(schema, 'u')} AS accountStatus,
         p.business_name AS businessName,
         ${providerExperienceColumn} AS experience,
         ${providerAreaColumn} AS serviceArea,
         ${providerDescriptionColumn} AS description,
         p.approval_status AS approvalStatus,
         CASE WHEN p.approval_status = 'rejected' THEN (
           SELECT audit.reason
           FROM admin_audit_log AS audit
           WHERE audit.entity_type = 'provider' AND audit.entity_id = p.user_id AND audit.action = 'rejected'
           ORDER BY audit.created_at DESC, audit.id DESC
           LIMIT 1
         ) ELSE NULL END AS rejectionReason,
         p.created_at AS createdAt
       FROM users AS u
       JOIN provider_profiles AS p ON p.user_id = u.id
       ${whereClause}
       ORDER BY p.created_at DESC`;

    const queryValues = hasPagination ? [...values, pagination.limit, (pagination.page - 1) * pagination.limit] : values;
    const [rows] = await pool.execute(sql, queryValues);

    res.json({ providers: rows, pagination: hasPagination ? pagination : { page: 1, limit: rows.length || 0, total, totalPages: 1, hasNextPage: false } });
  }));

  router.get('/providers/:id', [
    param('id').isInt({ min: 1 }).withMessage('Provider ID must be a positive integer.').toInt(),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const [providerRows] = await pool.execute(
      `SELECT
         u.id AS providerId,
         u.full_name AS fullName,
         u.email,
         ${userPhoneColumn} AS phone,
         ${getUserStatusSql(schema, 'u')} AS accountStatus,
         p.business_name AS businessName,
         ${providerExperienceColumn} AS experience,
         ${providerAreaColumn} AS serviceArea,
         ${providerDescriptionColumn} AS description,
         p.approval_status AS approvalStatus,
         CASE WHEN p.approval_status = 'rejected' THEN (
           SELECT audit.reason
           FROM admin_audit_log AS audit
           WHERE audit.entity_type = 'provider' AND audit.entity_id = p.user_id AND audit.action = 'rejected'
           ORDER BY audit.created_at DESC, audit.id DESC
           LIMIT 1
         ) ELSE NULL END AS rejectionReason,
         ${providerAddressColumn} AS address,
         ${providerCityColumn} AS city,
         p.created_at AS createdAt
       FROM users AS u
       JOIN provider_profiles AS p ON p.user_id = u.id
       WHERE u.id = ? AND u.role = 'provider'
       LIMIT 1`,
      [req.params.id]
    );

    if (providerRows.length === 0) {
      return res.status(404).json({ error: 'Provider not found.' });
    }

    const [serviceRows] = await pool.execute(
      `SELECT
         s.id,
         s.service_name AS serviceName,
         s.category,
         s.location,
         s.price,
         s.approval_status AS approvalStatus,
         s.is_available AS isAvailable,
         s.created_at AS createdAt
       FROM services AS s
       WHERE s.provider_id = ?
       ORDER BY s.created_at DESC
       LIMIT 10`,
      [req.params.id]
    );

    const [bookingRows] = await pool.execute(
      `SELECT
         b.id,
         b.booking_date AS bookingDate,
         b.booking_time AS bookingTime,
         b.status,
         b.total_amount AS totalAmount,
         customer.full_name AS customerName,
         s.service_name AS serviceName
       FROM bookings AS b
       JOIN users AS customer ON customer.id = b.customer_id
       JOIN services AS s ON s.id = b.service_id
       WHERE b.provider_id = ?
       ORDER BY b.created_at DESC
       LIMIT 10`,
      [req.params.id]
    );

    res.json({
      provider: providerRows[0],
      services: serviceRows,
      recentBookings: bookingRows
    });
  }));

  router.patch('/providers/:providerId/approve', [
    param('providerId').isInt({ min: 1 }).withMessage('Provider ID must be a positive integer.').toInt(),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const [result] = await pool.execute(
      `UPDATE provider_profiles AS p
       JOIN users AS u ON u.id = p.user_id
       SET p.approval_status = 'approved'
       WHERE p.user_id = ? AND u.role = 'provider'`,
      [req.params.providerId]
    );

    if (result.affectedRows !== 1) {
      const [rows] = await pool.execute(
        `SELECT p.user_id
         FROM provider_profiles AS p
         JOIN users AS u ON u.id = p.user_id
         WHERE p.user_id = ? AND u.role = 'provider'
         LIMIT 1`,
        [req.params.providerId]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Provider not found.' });
    }

    res.json({
      message: 'Provider approved.',
      provider: { id: Number(req.params.providerId), approvalStatus: 'approved' }
    });
  }));

  router.patch('/providers/:providerId/reject', [
    param('providerId').isInt({ min: 1 }).withMessage('Provider ID must be a positive integer.').toInt(),
    body('reason').isString().trim().isLength({ min: 5, max: 1000 }).withMessage('A rejection reason between 5 and 1,000 characters is required.'),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const updated = await withTransaction(pool, async (connection) => {
      const [rows] = await connection.execute(
        `SELECT p.user_id
         FROM provider_profiles AS p
         JOIN users AS u ON u.id = p.user_id
         WHERE p.user_id = ? AND u.role = 'provider'
         FOR UPDATE`,
        [req.params.providerId]
      );
      if (rows.length === 0) return false;
      await connection.execute(
        "UPDATE provider_profiles SET approval_status = 'rejected' WHERE user_id = ?",
        [req.params.providerId]
      );
      await writeAuditLog(connection, req.user.id, 'provider', req.params.providerId, 'rejected', req.body.reason);
      return true;
    });

    if (!updated) {
      return res.status(404).json({ error: 'Provider not found.' });
    }

    res.json({
      message: 'Provider rejected.',
      provider: { id: Number(req.params.providerId), approvalStatus: 'rejected', reason: req.body.reason }
    });
  }));

  router.patch('/providers/:providerId/status', [
    param('providerId').isInt({ min: 1 }).withMessage('Provider ID must be a positive integer.').toInt(),
    body('status').isIn(['active', 'blocked']).withMessage('Use active or blocked.'),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const statusValue = normalizeUserStatus(schema, req.body.status);
    const updateSql = schema?.users?.has('account_status')
      ? 'UPDATE users SET account_status = ? WHERE id = ? AND role = ?'
      : 'UPDATE users SET is_active = ? WHERE id = ? AND role = ?';

    const [result] = await pool.execute(updateSql, [statusValue, req.params.providerId, 'provider']);

    if (result.affectedRows !== 1) {
      const [rows] = await pool.execute(
        'SELECT id FROM users WHERE id = ? AND role = ? LIMIT 1',
        [req.params.providerId, 'provider']
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Provider not found.' });
    }

    res.json({
      message: 'Provider account updated.',
      provider: { id: Number(req.params.providerId), accountStatus: req.body.status }
    });
  }));

  router.patch('/providers/:providerId/approval', [
    param('providerId').isInt({ min: 1 }).withMessage('Provider ID must be a positive integer.').toInt(),
    body('approvalStatus').isIn(['approved', 'rejected']).withMessage('Choose approved or rejected.'),
    body('reason')
      .if(body('approvalStatus').equals('rejected'))
      .isString().withMessage('A rejection reason is required.')
      .bail()
      .trim()
      .isLength({ min: 5, max: 1000 }).withMessage('Rejection reason must be between 5 and 1,000 characters.'),
    validateRequest
  ], asyncHandler(async (req, res) => {
    if (req.body.approvalStatus === 'rejected') {
      const updated = await withTransaction(pool, async (connection) => {
        const [rows] = await connection.execute(
          `SELECT p.user_id
           FROM provider_profiles AS p
           JOIN users AS u ON u.id = p.user_id
           WHERE p.user_id = ? AND u.role = 'provider'
           FOR UPDATE`,
          [req.params.providerId]
        );
        if (rows.length === 0) return false;
        await connection.execute(
          "UPDATE provider_profiles SET approval_status = 'rejected' WHERE user_id = ?",
          [req.params.providerId]
        );
        await writeAuditLog(connection, req.user.id, 'provider', req.params.providerId, 'rejected', req.body.reason);
        return true;
      });
      if (!updated) return res.status(404).json({ error: 'Provider not found.' });
      return res.json({
        message: 'Provider rejected.',
        provider: { id: Number(req.params.providerId), approvalStatus: 'rejected', reason: req.body.reason }
      });
    }

    const [result] = await pool.execute(
      `UPDATE provider_profiles AS p
       JOIN users AS u ON u.id = p.user_id
       SET p.approval_status = ?
       WHERE p.user_id = ? AND u.role = ?`,
      [req.body.approvalStatus, req.params.providerId, 'provider']
    );

    if (result.affectedRows !== 1) {
      const [rows] = await pool.execute(
        `SELECT p.user_id
         FROM provider_profiles AS p
         JOIN users AS u ON u.id = p.user_id
         WHERE p.user_id = ? AND u.role = ?
         LIMIT 1`,
        [req.params.providerId, 'provider']
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Provider not found.' });
    }

    res.json({
      message: `Provider ${req.body.approvalStatus}.`,
      provider: { id: Number(req.params.providerId), approvalStatus: req.body.approvalStatus }
    });
  }));

  router.get('/services', [
    query('status').optional().isIn(['pending', 'approved', 'rejected', 'all']).withMessage('Choose pending, approved, rejected, or all.'),
    query('search').optional().trim().isLength({ max: 100 }).withMessage('Search text cannot exceed 100 characters.'),
    query('category').optional().trim().isLength({ min: 1, max: 100 }).withMessage('Category must be between 1 and 100 characters.'),
    query('providerId').optional().isInt({ min: 1 }).toInt(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const status = req.query.status || 'pending';
    const search = (req.query.search || '').trim();
    const category = (req.query.category || '').trim();
    const providerId = req.query.providerId ? safeNumber(req.query.providerId, 0) : 0;
    const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
    const page = hasPagination ? toPositiveInt(req.query.page, 1) : 1;
    const limit = hasPagination ? Math.min(100, toPositiveInt(req.query.limit, 20)) : 20;

    const filters = [];
    const values = [];

    if (status !== 'all') {
      filters.push('s.approval_status = ?');
      values.push(status);
    }
    if (search) {
      filters.push('(s.service_name LIKE ? OR s.category LIKE ? OR s.location LIKE ? OR provider.full_name LIKE ?)');
      const term = `%${search}%`;
      values.push(term, term, term, term);
    }
    if (category) {
      filters.push('s.category = ?');
      values.push(category);
    }
    if (providerId > 0) {
      filters.push('s.provider_id = ?');
      values.push(providerId);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM services AS s
       JOIN users AS provider ON provider.id = s.provider_id
       ${whereClause}`,
      values
    );
    const total = Number(countRows[0].total || 0);
    const pagination = buildPagination(page, limit, total);

    const sql = hasPagination
      ? `SELECT
         s.id,
         s.provider_id AS providerId,
         provider.full_name AS providerName,
         s.service_name AS serviceName,
         s.category,
         s.description,
         s.location,
         ${serviceImageColumn} AS image,
         s.price,
         ${servicePriceTypeColumn} AS priceType,
         s.is_available AS isAvailable,
         s.approval_status AS approvalStatus,
         CASE WHEN s.approval_status = 'rejected' THEN (
           SELECT audit.reason
           FROM admin_audit_log AS audit
           WHERE audit.entity_type = 'service' AND audit.entity_id = s.id AND audit.action = 'rejected'
           ORDER BY audit.created_at DESC, audit.id DESC
           LIMIT 1
         ) ELSE NULL END AS rejectionReason,
         s.created_at AS createdAt
       FROM services AS s
       JOIN users AS provider ON provider.id = s.provider_id
       ${whereClause}
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT ? OFFSET ?`
      : `SELECT
         s.id,
         s.provider_id AS providerId,
         provider.full_name AS providerName,
         s.service_name AS serviceName,
         s.category,
         s.description,
         s.location,
         ${serviceImageColumn} AS image,
         s.price,
         ${servicePriceTypeColumn} AS priceType,
         s.is_available AS isAvailable,
         s.approval_status AS approvalStatus,
         CASE WHEN s.approval_status = 'rejected' THEN (
           SELECT audit.reason
           FROM admin_audit_log AS audit
           WHERE audit.entity_type = 'service' AND audit.entity_id = s.id AND audit.action = 'rejected'
           ORDER BY audit.created_at DESC, audit.id DESC
           LIMIT 1
         ) ELSE NULL END AS rejectionReason,
         s.created_at AS createdAt
       FROM services AS s
       JOIN users AS provider ON provider.id = s.provider_id
       ${whereClause}
       ORDER BY s.created_at DESC, s.id DESC`;

    const queryValues = hasPagination ? [...values, pagination.limit, (pagination.page - 1) * pagination.limit] : values;
    const [rows] = await pool.execute(sql, queryValues);

    res.json({
      services: rows.map((service) => ({ ...service, isAvailable: Boolean(service.isAvailable) })),
      pagination: hasPagination ? pagination : { page: 1, limit: rows.length || 0, total, totalPages: 1, hasNextPage: false }
    });
  }));

  router.get('/services/:id', [
    param('id').isInt({ min: 1 }).withMessage('Service ID must be a positive integer.').toInt(),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT
         s.id,
         s.provider_id AS providerId,
         provider.full_name AS providerName,
         p.business_name AS businessName,
         s.service_name AS serviceName,
         s.category,
         s.description,
         s.location,
         ${serviceImageColumn} AS image,
         s.price,
         ${servicePriceTypeColumn} AS priceType,
         s.is_available AS isAvailable,
         s.approval_status AS approvalStatus,
         CASE WHEN s.approval_status = 'rejected' THEN (
           SELECT audit.reason
           FROM admin_audit_log AS audit
           WHERE audit.entity_type = 'service' AND audit.entity_id = s.id AND audit.action = 'rejected'
           ORDER BY audit.created_at DESC, audit.id DESC
           LIMIT 1
         ) ELSE NULL END AS rejectionReason,
         s.created_at AS createdAt
       FROM services AS s
       JOIN provider_profiles AS p ON p.user_id = s.provider_id
       JOIN users AS provider ON provider.id = s.provider_id
       WHERE s.id = ?
       LIMIT 1`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Service not found.' });
    }

    res.json({ service: { ...rows[0], isAvailable: Boolean(rows[0].isAvailable) } });
  }));

  router.patch('/services/:serviceId/approve', [
    param('serviceId').isInt({ min: 1 }).withMessage('Service ID must be a positive integer.').toInt(),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const [result] = await pool.execute(
      "UPDATE services SET approval_status = 'approved' WHERE id = ?",
      [req.params.serviceId]
    );

    if (result.affectedRows !== 1) {
      return res.status(404).json({ error: 'Service not found.' });
    }

    res.json({
      message: 'Service approved.',
      service: { id: Number(req.params.serviceId), approvalStatus: 'approved' }
    });
  }));

  router.patch('/services/:serviceId/reject', [
    param('serviceId').isInt({ min: 1 }).withMessage('Service ID must be a positive integer.').toInt(),
    body('reason').isString().trim().isLength({ min: 5, max: 1000 }).withMessage('A rejection reason between 5 and 1,000 characters is required.'),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const updated = await withTransaction(pool, async (connection) => {
      const [rows] = await connection.execute(
        'SELECT id FROM services WHERE id = ? FOR UPDATE',
        [req.params.serviceId]
      );
      if (rows.length === 0) return false;
      await connection.execute(
        "UPDATE services SET approval_status = 'rejected' WHERE id = ?",
        [req.params.serviceId]
      );
      await writeAuditLog(connection, req.user.id, 'service', req.params.serviceId, 'rejected', req.body.reason);
      return true;
    });

    if (!updated) {
      return res.status(404).json({ error: 'Service not found.' });
    }

    res.json({
      message: 'Service rejected.',
      service: { id: Number(req.params.serviceId), approvalStatus: 'rejected', reason: req.body.reason }
    });
  }));

  router.patch('/services/:serviceId/status', [
    param('serviceId').isInt({ min: 1 }).withMessage('Service ID must be a positive integer.').toInt(),
    body('isAvailable').isBoolean().withMessage('Availability must be true or false.').toBoolean(),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const [result] = await pool.execute(
      'UPDATE services SET is_available = ? WHERE id = ?',
      [req.body.isAvailable ? 1 : 0, req.params.serviceId]
    );

    if (result.affectedRows !== 1) {
      const [rows] = await pool.execute('SELECT id FROM services WHERE id = ? LIMIT 1', [req.params.serviceId]);
      if (rows.length === 0) return res.status(404).json({ error: 'Service not found.' });
    }

    res.json({
      message: 'Service availability updated.',
      service: { id: Number(req.params.serviceId), isAvailable: Boolean(req.body.isAvailable) }
    });
  }));

  router.patch('/services/:serviceId/approval', [
    param('serviceId').isInt({ min: 1 }).withMessage('Service ID must be a positive integer.').toInt(),
    body('approvalStatus').isIn(['approved', 'rejected']).withMessage('Choose approved or rejected.'),
    body('reason')
      .if(body('approvalStatus').equals('rejected'))
      .isString().withMessage('A rejection reason is required.')
      .bail()
      .trim()
      .isLength({ min: 5, max: 1000 }).withMessage('Rejection reason must be between 5 and 1,000 characters.'),
    validateRequest
  ], asyncHandler(async (req, res) => {
    if (req.body.approvalStatus === 'rejected') {
      const updated = await withTransaction(pool, async (connection) => {
        const [rows] = await connection.execute(
          'SELECT id FROM services WHERE id = ? FOR UPDATE',
          [req.params.serviceId]
        );
        if (rows.length === 0) return false;
        await connection.execute(
          "UPDATE services SET approval_status = 'rejected' WHERE id = ?",
          [req.params.serviceId]
        );
        await writeAuditLog(connection, req.user.id, 'service', req.params.serviceId, 'rejected', req.body.reason);
        return true;
      });
      if (!updated) return res.status(404).json({ error: 'Service not found.' });
      return res.json({
        message: 'Service rejected.',
        service: { id: Number(req.params.serviceId), approvalStatus: 'rejected', reason: req.body.reason }
      });
    }

    const [result] = await pool.execute(
      'UPDATE services SET approval_status = ? WHERE id = ?',
      [req.body.approvalStatus, req.params.serviceId]
    );

    if (result.affectedRows !== 1) {
      const [rows] = await pool.execute('SELECT id FROM services WHERE id = ? LIMIT 1', [req.params.serviceId]);
      if (rows.length === 0) return res.status(404).json({ error: 'Service not found.' });
    }

    res.json({
      message: `Service ${req.body.approvalStatus}.`,
      service: { id: Number(req.params.serviceId), approvalStatus: req.body.approvalStatus }
    });
  }));

  router.get('/bookings', [
    query('status').optional().isIn(['pending', 'accepted', 'rejected', 'cancelled', 'in_progress', 'completed', 'all']).withMessage('Choose a valid status.'),
    query('search').optional().trim().isLength({ max: 100 }).withMessage('Search text cannot exceed 100 characters.'),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const status = req.query.status || 'all';
    const search = (req.query.search || '').trim();
    const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
    const page = hasPagination ? toPositiveInt(req.query.page, 1) : 1;
    const limit = hasPagination ? Math.min(100, toPositiveInt(req.query.limit, 20)) : 20;

    const filters = [];
    const values = [];
    if (status !== 'all') {
      filters.push('b.status = ?');
      values.push(status);
    }
    if (search) {
      filters.push('(CAST(b.id AS CHAR) LIKE ? OR customer.full_name LIKE ? OR provider.full_name LIKE ? OR s.service_name LIKE ?)');
      const term = `%${search}%`;
      values.push(term, term, term, term);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM bookings AS b
       JOIN users AS customer ON customer.id = b.customer_id
       JOIN users AS provider ON provider.id = b.provider_id
       JOIN services AS s ON s.id = b.service_id
       ${whereClause}`,
      values
    );
    const total = Number(countRows[0].total || 0);
    const pagination = buildPagination(page, limit, total);

    const sql = hasPagination
      ? `SELECT
         b.id,
         b.customer_id AS customerId,
         customer.full_name AS customerName,
         b.provider_id AS providerId,
         provider.full_name AS providerName,
         b.service_id AS serviceId,
         s.service_name AS serviceName,
         b.booking_date AS bookingDate,
         b.booking_time AS bookingTime,
         b.address,
         b.total_amount AS totalAmount,
         b.status,
         b.created_at AS createdAt
       FROM bookings AS b
       JOIN users AS customer ON customer.id = b.customer_id
       JOIN users AS provider ON provider.id = b.provider_id
       JOIN services AS s ON s.id = b.service_id
       ${whereClause}
       ORDER BY b.created_at DESC
       LIMIT ? OFFSET ?`
      : `SELECT
         b.id,
         b.customer_id AS customerId,
         customer.full_name AS customerName,
         b.provider_id AS providerId,
         provider.full_name AS providerName,
         b.service_id AS serviceId,
         s.service_name AS serviceName,
         b.booking_date AS bookingDate,
         b.booking_time AS bookingTime,
         b.address,
         b.total_amount AS totalAmount,
         b.status,
         b.created_at AS createdAt
       FROM bookings AS b
       JOIN users AS customer ON customer.id = b.customer_id
       JOIN users AS provider ON provider.id = b.provider_id
       JOIN services AS s ON s.id = b.service_id
       ${whereClause}
       ORDER BY b.created_at DESC`;

    const queryValues = hasPagination ? [...values, pagination.limit, (pagination.page - 1) * pagination.limit] : values;
    const [rows] = await pool.execute(sql, queryValues);

    res.json({ bookings: rows, pagination: hasPagination ? pagination : { page: 1, limit: rows.length || 0, total, totalPages: 1, hasNextPage: false } });
  }));

  router.get('/bookings/:id', [
    param('id').isInt({ min: 1 }).withMessage('Booking ID must be a positive integer.').toInt(),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT
         b.id,
         b.customer_id AS customerId,
         customer.full_name AS customerName,
         customer.email AS customerEmail,
         b.provider_id AS providerId,
         provider.full_name AS providerName,
         b.service_id AS serviceId,
         s.service_name AS serviceName,
         s.category AS serviceCategory,
         b.booking_date AS bookingDate,
         b.booking_time AS bookingTime,
         b.address,
         b.description,
         b.customer_phone AS customerPhone,
         b.total_amount AS totalAmount,
         b.status,
         b.rejection_reason AS rejectionReason,
         (SELECT audit.reason
          FROM admin_audit_log AS audit
          WHERE audit.entity_type = 'booking' AND audit.entity_id = b.id AND audit.action = 'cancelled'
          ORDER BY audit.created_at DESC, audit.id DESC
          LIMIT 1) AS cancellationReason,
         b.created_at AS createdAt,
         b.status_updated_at AS statusUpdatedAt
       FROM bookings AS b
       JOIN users AS customer ON customer.id = b.customer_id
       JOIN users AS provider ON provider.id = b.provider_id
       JOIN services AS s ON s.id = b.service_id
       WHERE b.id = ?
       LIMIT 1`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    res.json({ booking: rows[0] });
  }));

  router.patch('/bookings/:id/cancel', [
    param('id').isInt({ min: 1 }).withMessage('Booking ID must be a positive integer.').toInt(),
    body('reason').isString().trim().isLength({ min: 5, max: 1000 }).withMessage('A cancellation reason between 5 and 1,000 characters is required.'),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const outcome = await withTransaction(pool, async (connection) => {
      const [bookingRows] = await connection.execute(
        'SELECT id, status FROM bookings WHERE id = ? FOR UPDATE',
        [req.params.id]
      );
      if (bookingRows.length === 0) return 'not_found';
      if (!['pending', 'accepted', 'in_progress'].includes(bookingRows[0].status)) return 'conflict';

      const [result] = await connection.execute(
        `UPDATE bookings
         SET status = 'cancelled', status_updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status IN ('pending', 'accepted', 'in_progress')`,
        [req.params.id]
      );
      if (result.affectedRows !== 1) return 'conflict';
      await writeAuditLog(connection, req.user.id, 'booking', req.params.id, 'cancelled', req.body.reason);
      return 'cancelled';
    });

    if (outcome === 'not_found') return res.status(404).json({ error: 'Booking not found.' });
    if (outcome === 'conflict') {
      return res.status(409).json({ error: 'This booking cannot be cancelled in its current state.' });
    }

    res.json({
      message: 'Booking cancelled.',
      booking: { id: Number(req.params.id), status: 'cancelled', cancellationReason: req.body.reason }
    });
  }));

  router.get('/reviews', [
    query('search').optional().trim().isLength({ max: 100 }).withMessage('Search text cannot exceed 100 characters.'),
    query('rating').optional().isInt({ min: 1, max: 5 }).toInt().withMessage('Rating must be between 1 and 5.'),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const exists = await tableExists(pool, 'reviews');
    if (!exists) {
      return res.json({ reviews: [], pagination: buildPagination(1, 20, 0) });
    }

    const search = (req.query.search || '').trim();
    const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
    const page = hasPagination ? toPositiveInt(req.query.page, 1) : 1;
    const limit = hasPagination ? Math.min(100, toPositiveInt(req.query.limit, 20)) : 20;
    const filters = [];
    const values = [];
    if (req.query.rating) {
      filters.push('r.rating = ?');
      values.push(req.query.rating);
    }
    if (search) {
      filters.push('(CAST(r.id AS CHAR) LIKE ? OR CAST(r.booking_id AS CHAR) LIKE ? OR customer.full_name LIKE ? OR provider.full_name LIKE ? OR s.service_name LIKE ? OR r.comment LIKE ?)');
      const term = `%${search}%`;
      values.push(term, term, term, term, term, term);
    }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const joins = `FROM reviews AS r
       JOIN users AS customer ON customer.id = r.customer_id
       JOIN users AS provider ON provider.id = r.provider_id
       JOIN bookings AS b ON b.id = r.booking_id
       JOIN services AS s ON s.id = b.service_id`;
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total ${joins} ${whereClause}`,
      values
    );
    const pagination = buildPagination(page, limit, Number(countRows[0].total || 0));
    const sql = hasPagination
      ? `SELECT
         r.id,
         r.booking_id AS bookingId,
         customer.full_name AS customerName,
         provider.full_name AS providerName,
         s.service_name AS serviceName,
         r.rating,
         r.comment,
         r.created_at AS createdAt
       ${joins}
       ${whereClause}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ? OFFSET ?`
      : `SELECT
         r.id,
         r.booking_id AS bookingId,
         customer.full_name AS customerName,
         provider.full_name AS providerName,
         s.service_name AS serviceName,
         r.rating,
         r.comment,
         r.created_at AS createdAt
       ${joins}
       ${whereClause}
       ORDER BY r.created_at DESC, r.id DESC`;
    const queryValues = hasPagination
      ? [...values, pagination.limit, (pagination.page - 1) * pagination.limit]
      : values;
    const [rows] = await pool.execute(
      sql,
      queryValues
    );

    res.json({
      reviews: rows,
      pagination: hasPagination
        ? pagination
        : { ...pagination, limit: rows.length, hasNextPage: false }
    });
  }));

  router.delete('/reviews/:id', [
    param('id').isInt({ min: 1 }).withMessage('Review ID must be a positive integer.').toInt(),
    body('reason').isString().trim().isLength({ min: 5, max: 1000 }).withMessage('A removal reason between 5 and 1,000 characters is required.'),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const exists = await tableExists(pool, 'reviews');
    if (!exists) {
      return res.status(404).json({ error: 'Reviews are not available in this installation.' });
    }

    const removed = await withTransaction(pool, async (connection) => {
      const [rows] = await connection.execute(
        'SELECT id FROM reviews WHERE id = ? FOR UPDATE',
        [req.params.id]
      );
      if (rows.length === 0) return false;
      await writeAuditLog(connection, req.user.id, 'review', req.params.id, 'removed', req.body.reason);
      const [result] = await connection.execute('DELETE FROM reviews WHERE id = ?', [req.params.id]);
      return result.affectedRows === 1;
    });
    if (!removed) {
      return res.status(404).json({ error: 'Review not found.' });
    }

    res.json({ message: 'Review removed and reason recorded.' });
  }));

  router.get('/messages', [
    query('status').optional().isIn(['new', 'in_progress', 'resolved', 'all']).withMessage('Choose a valid message status.'),
    query('search').optional().trim().isLength({ max: 100 }).withMessage('Search text cannot exceed 100 characters.'),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const exists = await tableExists(pool, 'contact_messages');
    if (!exists) {
      return res.json({ messages: [], pagination: buildPagination(1, 20, 0) });
    }

    const status = req.query.status || 'all';
    const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
    const page = hasPagination ? toPositiveInt(req.query.page, 1) : 1;
    const limit = hasPagination ? Math.min(100, toPositiveInt(req.query.limit, 20)) : 20;
    const filters = [];
    const values = [];

    if (status !== 'all') {
      filters.push('status = ?');
      values.push(status);
    }
    const search = (req.query.search || '').trim();
    if (search) {
      filters.push('(name LIKE ? OR email LIKE ? OR subject LIKE ? OR message LIKE ?)');
      const term = `%${search}%`;
      values.push(term, term, term, term);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const [countRows] = await pool.execute(`SELECT COUNT(*) AS total FROM contact_messages ${whereClause}`, values);
    const total = Number(countRows[0].total || 0);
    const pagination = buildPagination(page, limit, total);

    const sql = hasPagination
      ? `SELECT
         id,
         name,
         email,
         subject,
         message,
         status,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM contact_messages
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
      : `SELECT
         id,
         name,
         email,
         subject,
         message,
         status,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM contact_messages
       ${whereClause}
       ORDER BY created_at DESC`;

    const queryValues = hasPagination ? [...values, pagination.limit, (pagination.page - 1) * pagination.limit] : values;
    const [rows] = await pool.execute(sql, queryValues);

    res.json({ messages: rows, pagination: hasPagination ? pagination : { page: 1, limit: rows.length || 0, total, totalPages: 1, hasNextPage: false } });
  }));

  router.get('/messages/:id', [
    param('id').isInt({ min: 1 }).withMessage('Message ID must be a positive integer.').toInt(),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const exists = await tableExists(pool, 'contact_messages');
    if (!exists) {
      return res.status(404).json({ error: 'Contact messages are not available in this installation.' });
    }
    const [rows] = await pool.execute(
      `SELECT
         id, name, email, subject, message, status,
         created_at AS createdAt, updated_at AS updatedAt
       FROM contact_messages
       WHERE id = ?
       LIMIT 1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Message not found.' });
    res.json({ message: rows[0] });
  }));

  router.patch('/messages/:id/status', [
    param('id').isInt({ min: 1 }).withMessage('Message ID must be a positive integer.').toInt(),
    body('status').isIn(['new', 'in_progress', 'resolved']).withMessage('Choose new, in_progress, or resolved.'),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const exists = await tableExists(pool, 'contact_messages');
    if (!exists) {
      return res.status(404).json({ error: 'Contact messages are not available in this installation.' });
    }

    const [result] = await pool.execute(
      'UPDATE contact_messages SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [req.body.status, req.params.id]
    );

    if (result.affectedRows !== 1) {
      const [rows] = await pool.execute('SELECT id FROM contact_messages WHERE id = ? LIMIT 1', [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: 'Message not found.' });
    }

    res.json({
      message: 'Message status updated.',
      contactMessage: { id: Number(req.params.id), status: req.body.status }
    });
  }));

  return router;
}

module.exports = { createAdminRouter };
