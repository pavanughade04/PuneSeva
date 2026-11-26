
const express = require('express');
const {
  body,
  param,
  validationResult
} = require('express-validator');

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

// Validation helper
function validateRequest(req, res, next) {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed.',
      details: errors.array()
    });
  }

  next();
}

// Positive integer helper
function toPositiveInt(value, fallback) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0
    ? number
    : fallback;
}

// Pagination helper
function pagination(req) {
  const page = toPositiveInt(req.query.page, 1);
  const limit = Math.min(toPositiveInt(req.query.limit, 10), 100);

  return {
    page,
    limit,
    offset: (page - 1) * limit
  };
}

// Pagination response
function paginationMeta(page, limit, total) {
  const totalItems = Number(total) || 0;
  const totalPages = Math.ceil(totalItems / limit);

  return {
    page,
    limit,
    total: totalItems,
    totalPages,
    hasNextPage: page < totalPages
  };
}

// Audit log helper
async function writeAuditLog(
  client,
  adminId,
  entityType,
  entityId,
  action,
  reason
) {
  if (!adminId) {
    throw new Error('Admin ID is required for audit logging.');
  }

  await client.query(
    `INSERT INTO admin_audit_log
      (admin_id, entity_type, entity_id, action, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [adminId, entityType, entityId, action, reason || null]
  );
}

// Transaction helper
async function withTransaction(pool, callback) {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const result = await callback(client);

    await client.query('COMMIT');
    transactionStarted = false;

    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

function adminIdFromRequest(req) {
  return Number(req.user?.id);
}

function createAdminRouter({ pool, schema = {} }) {
  const router = express.Router();

  // Authentication and admin authorization are handled
  // by the parent application before this router is mounted.

  // ==========================================
  // DASHBOARD
  // ==========================================

  router.get('/dashboard', asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM users WHERE role = 'customer') AS customers,
        (SELECT COUNT(*) FROM users WHERE role = 'provider') AS providers,
        (SELECT COUNT(*) FROM services) AS services,
        (SELECT COUNT(*) FROM bookings) AS bookings,
        (SELECT COUNT(*) FROM bookings WHERE status = 'pending') AS pending_bookings,
        (SELECT COUNT(*) FROM provider_profiles WHERE approval_status = 'pending') AS pending_providers`
    );

    res.json({ dashboard: result.rows[0] });
  }));


  router.get('/dashboard/stats', asyncHandler(async (req, res) => {
    const statsResult = await pool.query(
      `SELECT
        (
          SELECT COUNT(*)
          FROM users
          WHERE role = 'customer'
        ) AS customers_total,

        (
          SELECT COUNT(*)
          FROM users
          WHERE role = 'provider'
        ) AS providers_total,

        (
          SELECT COUNT(*)
          FROM provider_profiles
          WHERE approval_status = 'pending'
        ) AS providers_pending,

        (
          SELECT COUNT(*)
          FROM services
        ) AS services_total,

        (
          SELECT COUNT(*)
          FROM services
          WHERE approval_status = 'pending'
        ) AS services_pending,

        (
          SELECT COUNT(*)
          FROM bookings
        ) AS bookings_total,

        (
          SELECT COUNT(*)
          FROM bookings
          WHERE status = 'pending'
        ) AS bookings_pending,

        (
          SELECT COUNT(*)
          FROM bookings
          WHERE status = 'completed'
        ) AS bookings_completed,

        (
          SELECT COUNT(*)
          FROM bookings
          WHERE status = 'cancelled'
        ) AS bookings_cancelled,

        (
          SELECT COUNT(*)
          FROM reviews
        ) AS reviews_total`
    );

    const [bookingsResult, providersResult, servicesResult] =
      await Promise.all([
        pool.query(
          `SELECT
            b.id,
            b.created_at AS "createdAt",
            cu.full_name AS "customerName",
            pu.full_name AS "providerName",
            s.service_name AS "serviceName",
            b.status
           FROM bookings b
           JOIN users cu ON cu.id = b.customer_id
           JOIN users pu ON pu.id = b.provider_id
           JOIN services s ON s.id = b.service_id
           ORDER BY b.created_at DESC
           LIMIT 5`
        ),

        pool.query(
          `SELECT
            u.full_name AS "fullName",
            p.business_name AS "businessName",
            p.approval_status AS "approvalStatus",
            p.created_at AS "createdAt"
           FROM provider_profiles p
           JOIN users u ON u.id = p.user_id
           WHERE u.role = 'provider'
           ORDER BY p.created_at DESC NULLS LAST
           LIMIT 5`
        ),

        pool.query(
          `SELECT
            s.id,
            s.service_name AS "serviceName",
            pu.full_name AS "providerName",
            s.category,
            s.approval_status AS "approvalStatus"
           FROM services s
           JOIN users pu ON pu.id = s.provider_id
           ORDER BY s.created_at DESC
           LIMIT 5`
        )
      ]);

    const counts = statsResult.rows[0];

    res.json({
      stats: {
        customers: {
          total: counts.customers_total
        },
        providers: {
          total: counts.providers_total,
          pending: counts.providers_pending
        },
        services: {
          total: counts.services_total,
          pending: counts.services_pending
        },
        bookings: {
          total: counts.bookings_total,
          pending: counts.bookings_pending,
          completed: counts.bookings_completed,
          cancelled: counts.bookings_cancelled
        },
        reviews: {
          total: counts.reviews_total
        }
      },
      recentActivity: {
        recentBookings: bookingsResult.rows,
        recentProviders: providersResult.rows,
        recentServices: servicesResult.rows
      }
    });
  }));


  // ==========================================
  // CUSTOMERS
  // ==========================================


  router.get('/customers', asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const search = String(req.query.search || '').trim();

    const values = [];
    let where = `WHERE u.role = 'customer'`;

    if (search) {
      values.push(`%${search}%`);

      where += ` AND (
        u.full_name ILIKE $${values.length}
        OR u.email ILIKE $${values.length}
        OR u.phone ILIKE $${values.length}
      )`;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM users u
       ${where}`,
      values
    );

    const listValues = [...values, limit, offset];

    const result = await pool.query(
      `SELECT
        u.id AS "customerId",
        u.full_name AS "fullName",
        u.email,
        u.phone,
        CASE
          WHEN u.is_active THEN 'active'
          ELSE 'blocked'
        END AS "accountStatus",
        u.created_at AS "createdAt",
        (
          SELECT COUNT(*)::int
          FROM bookings b
          WHERE b.customer_id = u.id
        ) AS "bookingCount"
       FROM users u
       ${where}
       ORDER BY u.created_at DESC
       LIMIT $${listValues.length - 1}
       OFFSET $${listValues.length}`,
      listValues
    );

    res.json({
      customers: result.rows,
      pagination: paginationMeta(
        page,
        limit,
        countResult.rows[0].total
      )
    });
  }));



  router.get('/customers/:customerId', [
    param('customerId').isInt({ min: 1 }),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const customerId = Number(req.params.customerId);

    const result = await pool.query(
      `SELECT
        u.id AS "customerId",
        u.full_name AS "fullName",
        u.email,
        u.phone,
        CASE
          WHEN u.is_active THEN 'active'
          ELSE 'blocked'
        END AS "accountStatus",
        u.created_at AS "createdAt",
        cp.address,
        cp.area,
        cp.city,
        cp.profile_image AS "profileImage"
       FROM users u
       LEFT JOIN customer_profiles cp ON cp.user_id = u.id
       WHERE u.id = $1 AND u.role = 'customer'`,
      [customerId]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: 'Customer not found.'
      });
    }

    const bookingsResult = await pool.query(
      `SELECT
        b.id,
        s.service_name AS "serviceName",
        pu.full_name AS "providerName",
        b.booking_date AS "bookingDate",
        b.status,
        b.total_amount AS "totalAmount"
       FROM bookings b
       JOIN users pu ON pu.id = b.provider_id
       JOIN services s ON s.id = b.service_id
       WHERE b.customer_id = $1
       ORDER BY b.created_at DESC
       LIMIT 10`,
      [customerId]
    );

    res.json({
      customer: result.rows[0],
      recentBookings: bookingsResult.rows
    });
  }));



  router.patch('/customers/:customerId/status', [
  param('customerId').isInt({ min: 1 }),
  body('status').isIn(['active', 'blocked']),
  validateRequest
], asyncHandler(async (req, res) => {
  const customerId = Number(req.params.customerId);
  const isActive = req.body.status === 'active';
  const adminId = adminIdFromRequest(req);

  const customer = await withTransaction(pool, async (client) => {
    const result = await client.query(
      `UPDATE users
       SET is_active = $1
       WHERE id = $2 AND role = 'customer'
       RETURNING
         id,
         is_active AS "isActive",
         CASE
           WHEN is_active THEN 'active'
           ELSE 'blocked'
         END AS "accountStatus"`,
      [isActive, customerId]
    );

    if (!result.rowCount) {
      return null;
    }

    await writeAuditLog(
      client,
      adminId,
      'customer',
      customerId,
      isActive ? 'activated' : 'blocked',
      isActive
        ? 'Customer activated by admin.'
        : 'Customer blocked by admin.'
    );

    return result.rows[0];
  });

  if (!customer) {
    return res.status(404).json({
      error: 'Customer not found.'
    });
  }

  res.json({
    message: 'Customer status updated.',
    customer
  });
}));


  // ==========================================
  // PROVIDERS
  // ==========================================


  router.get('/providers', asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const status = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim();

    const values = [];
    let where = `WHERE u.role = 'provider'`;

    if (status && status !== 'all') {
      values.push(status);
      where += ` AND p.approval_status = $${values.length}`;
    }

    if (search) {
      values.push(`%${search}%`);

      where += ` AND (
        u.full_name ILIKE $${values.length}
        OR u.email ILIKE $${values.length}
        OR p.business_name ILIKE $${values.length}
      )`;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM users u
       LEFT JOIN provider_profiles p ON p.user_id = u.id
       ${where}`,
      values
    );

    const listValues = [...values, limit, offset];

    const result = await pool.query(
      `SELECT
        u.id AS "providerId",
        u.full_name AS "fullName",
        u.email,
        u.phone,
        CASE
          WHEN u.is_active THEN 'active'
          ELSE 'blocked'
        END AS "accountStatus",
        p.business_name AS "businessName",
        p.experience_years AS "experienceYears",
        p.service_area AS "serviceArea",
        p.description,
        p.approval_status AS "approvalStatus",
        p.created_at AS "createdAt",
        (
          SELECT COUNT(*)::int
          FROM bookings b
          WHERE b.provider_id = u.id
        ) AS "bookingCount"
       FROM users u
       LEFT JOIN provider_profiles p ON p.user_id = u.id
       ${where}
       ORDER BY p.created_at DESC NULLS LAST
       LIMIT $${listValues.length - 1}
       OFFSET $${listValues.length}`,
      listValues
    );

    res.json({
      providers: result.rows,
      pagination: paginationMeta(
        page,
        limit,
        countResult.rows[0].total
      )
    });
  }));



  router.get('/providers/:providerId', [
    param('providerId').isInt({ min: 1 }),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const providerId = Number(req.params.providerId);

    const result = await pool.query(
      `SELECT
        u.id AS "providerId",
        u.full_name AS "fullName",
        u.email,
        u.phone,
        CASE
          WHEN u.is_active THEN 'active'
          ELSE 'blocked'
        END AS "accountStatus",
        p.business_name AS "businessName",
        p.experience_years AS "experience",
        p.service_area AS "serviceArea",
        p.description,
        p.approval_status AS "approvalStatus",
        (
          SELECT al.reason
          FROM admin_audit_log al
          WHERE al.entity_type = 'provider'
            AND al.entity_id = u.id
            AND al.action = 'rejected'
          ORDER BY al.created_at DESC, al.id DESC
          LIMIT 1
        ) AS "rejectionReason",
        p.created_at AS "createdAt"
       FROM users u
       LEFT JOIN provider_profiles p ON p.user_id = u.id
       WHERE u.id = $1 AND u.role = 'provider'`,
      [providerId]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: 'Provider not found.'
      });
    }

    const servicesResult = await pool.query(
      `SELECT
        s.service_name AS "serviceName",
        s.category,
        s.location,
        s.approval_status AS "approvalStatus"
       FROM services s
       WHERE s.provider_id = $1
       ORDER BY s.created_at DESC
       LIMIT 20`,
      [providerId]
    );

    const bookingsResult = await pool.query(
      `SELECT
        b.id,
        cu.full_name AS "customerName",
        s.service_name AS "serviceName",
        b.booking_date AS "bookingDate",
        b.status,
        b.total_amount AS "totalAmount"
       FROM bookings b
       JOIN users cu ON cu.id = b.customer_id
       JOIN services s ON s.id = b.service_id
       WHERE b.provider_id = $1
       ORDER BY b.created_at DESC
       LIMIT 10`,
      [providerId]
    );

    res.json({
      provider: result.rows[0],
      services: servicesResult.rows,
      recentBookings: bookingsResult.rows
    });
  }));


  router.patch('/providers/:providerId/approve', [
    param('providerId').isInt({ min: 1 }),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const providerId = Number(req.params.providerId);
    const adminId = adminIdFromRequest(req);

    const outcome = await withTransaction(pool, async (client) => {
      const provider = await client.query(
        `SELECT p.user_id
         FROM provider_profiles p
         JOIN users u ON u.id = p.user_id
         WHERE p.user_id = $1 AND u.role = 'provider'
         FOR UPDATE OF u, p`,
        [providerId]
      );

      if (!provider.rowCount) return null;

      await client.query(
        `UPDATE provider_profiles
         SET approval_status = 'approved'
         WHERE user_id = $1`,
        [providerId]
      );

      await writeAuditLog(
        client,
        adminId,
        'provider',
        providerId,
        'approved',
        'Provider approved by admin.'
      );

      return {
        userId: providerId,
        approvalStatus: 'approved'
      };
    });

    if (!outcome) {
      return res.status(404).json({
        error: 'Provider not found.'
      });
    }

    res.json({
      message: 'Provider approved successfully.',
      provider: outcome
    });
  }));

  router.patch('/providers/:providerId/reject', [
    param('providerId').isInt({ min: 1 }),
    body('reason')
      .isString()
      .bail()
      .trim()
      .isLength({ min: 5, max: 1000 }),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const providerId = Number(req.params.providerId);
    const reason = String(req.body.reason).trim();
    const adminId = adminIdFromRequest(req);

    const outcome = await withTransaction(pool, async (client) => {
      const provider = await client.query(
        `SELECT p.user_id
         FROM provider_profiles p
         JOIN users u ON u.id = p.user_id
         WHERE p.user_id = $1 AND u.role = 'provider'
         FOR UPDATE OF u, p`,
        [providerId]
      );

      if (!provider.rowCount) return null;

      await client.query(
        `UPDATE provider_profiles
         SET approval_status = 'rejected'
         WHERE user_id = $1`,
        [providerId]
      );

      await writeAuditLog(
        client,
        adminId,
        'provider',
        providerId,
        'rejected',
        reason
      );

      return {
        userId: providerId,
        approvalStatus: 'rejected',
        reason
      };
    });

    if (!outcome) {
      return res.status(404).json({
        error: 'Provider not found.'
      });
    }

    res.json({
      message: 'Provider rejected successfully.',
      provider: outcome
    });
  }));



router.patch('/providers/:providerId/status', [
  param('providerId').isInt({ min: 1 }),
  body('status').isIn(['active', 'blocked']),
  validateRequest
], asyncHandler(async (req, res) => {
  const providerId = Number(req.params.providerId);
  const isActive = req.body.status === 'active';
  const adminId = adminIdFromRequest(req);

  const provider = await withTransaction(pool, async (client) => {
    const result = await client.query(
      `UPDATE users
       SET is_active = $1
       WHERE id = $2 AND role = 'provider'
       RETURNING
         id,
         is_active AS "isActive",
         CASE
           WHEN is_active THEN 'active'
           ELSE 'blocked'
         END AS "accountStatus"`,
      [isActive, providerId]
    );

    if (!result.rowCount) {
      return null;
    }

    await writeAuditLog(
      client,
      adminId,
      'provider',
      providerId,
      isActive ? 'activated' : 'blocked',
      isActive
        ? 'Provider activated by admin.'
        : 'Provider blocked by admin.'
    );

    return result.rows[0];
  });

  if (!provider) {
    return res.status(404).json({
      error: 'Provider not found.'
    });
  }

  res.json({
    message: 'Provider status updated.',
    provider
  });
}));



  // ==========================================
  // SERVICES
  // ==========================================


router.get('/services', asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const status = String(req.query.status || '').trim();
  const category = String(req.query.category || '').trim();
  const search = String(req.query.search || '').trim();

  const values = [];
  const conditions = [];

  if (status && status !== 'all') {
    if (status === 'available') {
      conditions.push('s.is_available = TRUE');
    } else if (status === 'unavailable') {
      conditions.push('s.is_available = FALSE');
    } else {
      values.push(status);
      conditions.push(`s.approval_status = $${values.length}`);
    }
  }

  if (category) {
    values.push(category);
    conditions.push(`s.category = $${values.length}`);
  }

  if (search) {
    values.push(`%${search}%`);
    conditions.push(`(
      s.service_name ILIKE $${values.length}
      OR s.category ILIKE $${values.length}
      OR s.location ILIKE $${values.length}
    )`);
  }

  const where = conditions.length
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const countResult = await pool.query(
    `SELECT COUNT(*) AS total
     FROM services s
     JOIN users u ON u.id = s.provider_id
     ${where}`,
    values
  );

  const listValues = [...values, limit, offset];

  const result = await pool.query(
    `SELECT
      s.id,
      s.provider_id AS "providerId",
      u.full_name AS "providerName",
      s.service_name AS "serviceName",
      s.category,
      s.description,
      s.location,
      s.image,
      s.price,
      s.price_type AS "priceType",
      s.is_available AS "isAvailable",
      s.approval_status AS "approvalStatus",
      s.created_at AS "createdAt"
     FROM services s
     JOIN users u ON u.id = s.provider_id
     ${where}
     ORDER BY s.created_at DESC
     LIMIT $${listValues.length - 1}
     OFFSET $${listValues.length}`,
    listValues
  );

  res.json({
    services: result.rows,
    pagination: paginationMeta(
      page,
      limit,
      countResult.rows[0].total
    )
  });
}));




router.get('/services/:serviceId', [
  param('serviceId').isInt({ min: 1 }),
  validateRequest
], asyncHandler(async (req, res) => {
  const serviceId = Number(req.params.serviceId);

  const result = await pool.query(
    `SELECT
      s.id,
      s.service_name AS "serviceName",
      pu.full_name AS "providerName",
      s.provider_id AS "providerId",
      pp.business_name AS "businessName",
      s.category,
      s.description,
      s.location,
      s.price,
      s.price_type AS "priceType",
      s.approval_status AS "approvalStatus",
      s.is_available AS "isAvailable",
      (
        SELECT al.reason
        FROM admin_audit_log al
        WHERE al.entity_type = 'service'
          AND al.entity_id = s.id
          AND al.action = 'rejected'
        ORDER BY al.created_at DESC, al.id DESC
        LIMIT 1
      ) AS "rejectionReason",
      s.created_at AS "createdAt",
      s.image
     FROM services s
     JOIN users pu ON pu.id = s.provider_id
     LEFT JOIN provider_profiles pp ON pp.user_id = s.provider_id
     WHERE s.id = $1`,
    [serviceId]
  );

  if (!result.rowCount) {
    return res.status(404).json({
      error: 'Service not found.'
    });
  }

  res.json({
    service: result.rows[0]
  });
}));



  router.patch('/services/:serviceId/approve', [
    param('serviceId').isInt({ min: 1 }),
    validateRequest
  ], asyncHandler(async (req, res) => {


    const serviceId = Number(req.params.serviceId);
    const adminId = adminIdFromRequest(req);

    const outcome = await withTransaction(pool, async (client) => {
      const service = await client.query(
        `SELECT id FROM services WHERE id = $1 FOR UPDATE`,
        [serviceId]
      );

      if (!service.rowCount) return false;

      await client.query(
        `UPDATE services
         SET approval_status = 'approved'
         WHERE id = $1`,
        [serviceId]
      );

      await writeAuditLog(
        client,
        adminId,
        'service',
        serviceId,
        'approved',
        'Service approved by admin.'
      );

      return true;
    });

    if (!outcome) {
      return res.status(404).json({
        error: 'Service not found.'
      });
    }

    res.json({ message: 'Service approved successfully.' });
  }));


router.patch('/services/:serviceId/reject', [
  param('serviceId').isInt({ min: 1 }),
  body('reason')
    .isString()
    .bail()
    .trim()
    .isLength({ min: 5, max: 1000 }),
  validateRequest
], asyncHandler(async (req, res) => {
  const serviceId = Number(req.params.serviceId);
  const reason = String(req.body.reason).trim();
  const adminId = adminIdFromRequest(req);

  const outcome = await withTransaction(pool, async (client) => {
    const service = await client.query(
      `SELECT id FROM services WHERE id = $1 FOR UPDATE`,
      [serviceId]
    );

    if (!service.rowCount) return null;

    await client.query(
      `UPDATE services
       SET approval_status = 'rejected'
       WHERE id = $1`,
      [serviceId]
    );

    await writeAuditLog(
      client,
      adminId,
      'service',
      serviceId,
      'rejected',
      reason
    );

    return true;
  });

  if (!outcome) {
    return res.status(404).json({
      error: 'Service not found.'
    });
  }

  res.json({
    message: 'Service rejected successfully.'
  });
}));



router.patch('/services/:serviceId/status', [
  param('serviceId').isInt({ min: 1 }),
  body('isAvailable').isBoolean(),
  validateRequest
], asyncHandler(async (req, res) => {
  const serviceId = Number(req.params.serviceId);
  const isAvailable = req.body.isAvailable;
  const adminId = adminIdFromRequest(req);

  const service = await withTransaction(pool, async (client) => {
    const existing = await client.query(
      `SELECT id FROM services WHERE id = $1 FOR UPDATE`,
      [serviceId]
    );

    if (!existing.rowCount) {
      return null;
    }

    const result = await client.query(
      `UPDATE services
       SET is_available = $1
       WHERE id = $2
       RETURNING id, is_available AS "isAvailable"`,
      [isAvailable, serviceId]
    );

    await writeAuditLog(
      client,
      adminId,
      'service',
      serviceId,
      'availability_updated',
      isAvailable
        ? 'Service made available by admin.'
        : 'Service made unavailable by admin.'
    );

    return result.rows[0];
  });

  if (!service) {
    return res.status(404).json({
      error: 'Service not found.'
    });
  }

  res.json({
    message: 'Service status updated.',
    service
  });
}));


  // ==========================================
  // BOOKINGS
  // ==========================================

  router.get('/bookings', asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const status = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim();

    const values = [];
    const conditions = [];

    if (status && status !== 'all') {
      values.push(status);
      conditions.push(`b.status = $${values.length}`);
    }

    if (search) {
      values.push(`%${search}%`);
      conditions.push(`(
        cu.full_name ILIKE $${values.length}
        OR pu.full_name ILIKE $${values.length}
        OR s.service_name ILIKE $${values.length}
      )`);
    }

    const where = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM bookings b
       JOIN users cu ON cu.id = b.customer_id
       JOIN users pu ON pu.id = b.provider_id
       JOIN services s ON s.id = b.service_id
       ${where}`,
      values
    );

    const listValues = [...values, limit, offset];

    const result = await pool.query(
      `SELECT
        b.id,
        b.customer_id AS "customerId",
        cu.full_name AS "customerName",
        b.provider_id AS "providerId",
        pu.full_name AS "providerName",
        b.service_id AS "serviceId",
        s.service_name AS "serviceName",
        b.booking_date AS "bookingDate",
        b.booking_time AS "bookingTime",
        b.address,
        b.customer_phone AS "customerPhone",
        b.description,
        b.total_amount AS "totalAmount",
        b.status,
        b.rejection_reason AS "rejectionReason",
        b.created_at AS "createdAt"
       FROM bookings b
       JOIN users cu ON cu.id = b.customer_id
       JOIN users pu ON pu.id = b.provider_id
       JOIN services s ON s.id = b.service_id
       ${where}
       ORDER BY b.created_at DESC
       LIMIT $${listValues.length - 1}
       OFFSET $${listValues.length}`,
      listValues
    );

    res.json({
      bookings: result.rows,
      pagination: paginationMeta(
        page,
        limit,
        countResult.rows[0].total
      )
    });
  }));


  router.get('/bookings/:bookingId', [
    param('bookingId').isInt({ min: 1 }),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const bookingId = Number(req.params.bookingId);

    const result = await pool.query(
      `SELECT
        b.id,
        b.status,
        cu.full_name AS "customerName",
        cu.email AS "customerEmail",
        b.customer_phone AS "customerPhone",
        pu.full_name AS "providerName",
        s.service_name AS "serviceName",
        s.category AS "serviceCategory",
        b.booking_date AS "bookingDate",
        b.booking_time AS "bookingTime",
        b.address,
        b.description,
        b.total_amount AS "totalAmount",
        b.rejection_reason AS "rejectionReason",
        (
          SELECT al.reason
          FROM admin_audit_log al
          WHERE al.entity_type = 'booking'
            AND al.entity_id = b.id
            AND al.action = 'cancelled'
          ORDER BY al.created_at DESC, al.id DESC
          LIMIT 1
        ) AS "cancellationReason",
        b.created_at AS "createdAt",
        b.status_updated_at AS "statusUpdatedAt"
       FROM bookings b
       JOIN users cu ON cu.id = b.customer_id
       JOIN users pu ON pu.id = b.provider_id
       JOIN services s ON s.id = b.service_id
       WHERE b.id = $1`,
      [bookingId]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: 'Booking not found.'
      });
    }

    res.json({
      booking: result.rows[0]
    });
  }));


  const cancelBookingHandler = asyncHandler(async (req, res) => {
    const bookingId = Number(req.params.bookingId);
    const reason = String(req.body.reason || '').trim();
    const adminId = adminIdFromRequest(req);

    const outcome = await withTransaction(pool, async (client) => {
      const booking = await client.query(
        `SELECT id, status FROM bookings WHERE id = $1 FOR UPDATE`,
        [bookingId]
      );

      if (!booking.rowCount) {
        return { notFound: true };
      }

      const currentStatus = booking.rows[0].status;
      const allowedStatuses = [
        'pending',
        'accepted',
        'in_progress'
      ];

      if (!allowedStatuses.includes(currentStatus)) {
        return {
          conflict: true,
          currentStatus
        };
      }

      const update = await client.query(
        `UPDATE bookings
         SET status = 'cancelled',
             status_updated_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
           AND status IN ('pending', 'accepted', 'in_progress')
         RETURNING id, status`,
        [bookingId]
      );

      if (!update.rowCount) {
        return {
          conflict: true,
          currentStatus: 'changed'
        };
      }

      await writeAuditLog(
        client,
        adminId,
        'booking',
        bookingId,
        'cancelled',
        reason || 'Cancelled by admin.'
      );

      return {
        booking: {
          id: bookingId,
          status: 'cancelled'
        }
      };
    });

    if (outcome.notFound) {
      return res.status(404).json({
        error: 'Booking not found.'
      });
    }

    if (outcome.conflict) {
      return res.status(409).json({
        error: `Booking with status "${outcome.currentStatus}" cannot be cancelled.`
      });
    }

    res.json({
      message: 'Booking cancelled successfully.',
      booking: outcome.booking
    });
  });

  router.patch('/bookings/:bookingId/cancel', [
    param('bookingId').isInt({ min: 1 }),
    body('reason').optional().isString().trim().isLength({ max: 1000 }),
    validateRequest
  ], cancelBookingHandler);

  router.put('/bookings/:bookingId/cancel', [
    param('bookingId').isInt({ min: 1 }),
    body('reason').optional().isString().trim().isLength({ max: 1000 }),
    validateRequest
  ], cancelBookingHandler);

  // ==========================================
  // RECENT ACTIVITY
  // ==========================================

  router.get('/dashboard/recent-activity', asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT *
       FROM (
         SELECT
           'booking' AS "entityType",
           b.id AS "entityId",
           'Booking created' AS action,
           cu.full_name AS "actorName",
           b.created_at AS "createdAt"
         FROM bookings b
         LEFT JOIN users cu ON cu.id = b.customer_id

         UNION ALL

         SELECT
           'review' AS "entityType",
           r.id AS "entityId",
           'Review submitted' AS action,
           cu.full_name AS "actorName",
           r.created_at AS "createdAt"
         FROM reviews r
         LEFT JOIN users cu ON cu.id = r.customer_id

         UNION ALL

         SELECT
           'contact_message' AS "entityType",
           cm.id AS "entityId",
           'Contact message received' AS action,
           cm.name AS "actorName",
           cm.created_at AS "createdAt"
         FROM contact_messages cm
       ) activity
       ORDER BY activity."createdAt" DESC
       LIMIT 20`
    );

    res.json({ activities: result.rows });
  }));

  // ==========================================
  // REVIEWS
  // ==========================================

  router.get('/reviews', asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const rating = String(req.query.rating || '').trim();

    const values = [];
    let where = '';

    if (rating) {
      const parsedRating = Number(rating);

      if (
        !Number.isInteger(parsedRating) ||
        parsedRating < 1 ||
        parsedRating > 5
      ) {
        return res.status(400).json({
          error: 'Invalid rating filter.'
        });
      }

      values.push(parsedRating);
      where = `WHERE r.rating = $${values.length}`;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM reviews r
       ${where}`,
      values
    );

    const listValues = [...values, limit, offset];

    const result = await pool.query(
      `SELECT
        r.id,
        r.booking_id AS "bookingId",
        r.customer_id AS "customerId",
        cu.full_name AS "customerName",
        r.provider_id AS "providerId",
        pu.full_name AS "providerName",
        r.rating,
        r.comment,
        r.created_at AS "createdAt"
       FROM reviews r
       JOIN users cu ON cu.id = r.customer_id
       JOIN users pu ON pu.id = r.provider_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${listValues.length - 1}
       OFFSET $${listValues.length}`,
      listValues
    );

    res.json({
      reviews: result.rows,
      pagination: paginationMeta(
        page,
        limit,
        countResult.rows[0].total
      )
    });
  }));

  router.delete('/reviews/:reviewId', [
    param('reviewId').isInt({ min: 1 }),
   body('reason')
  .optional()
  .isString()
  .bail()
  .trim()
  .isLength({ max: 1000 }),
   validateRequest
  ], asyncHandler(async (req, res) => {
    const reviewId = Number(req.params.reviewId);
    const adminId = adminIdFromRequest(req);
    const reason = String(req.body.reason || '').trim();

    const outcome = await withTransaction(pool, async (client) => {
      const review = await client.query(
        `SELECT id FROM reviews WHERE id = $1 FOR UPDATE`,
        [reviewId]
      );

      if (!review.rowCount) return false;

      await client.query(
        `DELETE FROM reviews WHERE id = $1`,
        [reviewId]
      );

      await writeAuditLog(
        client,
        adminId,
        'review',
        reviewId,
        'deleted',
        reason || 'Review deleted by admin.'
      );

      return true;
    });

    if (!outcome) {
      return res.status(404).json({
        error: 'Review not found.'
      });
    }

    res.json({ message: 'Review deleted successfully.' });
  }));

  // ==========================================
  // CONTACT MESSAGES
  // ==========================================


router.get('/messages', asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const status = String(req.query.status || '').trim();

  if (
    status &&
    status !== 'all' &&
    !['new', 'in_progress', 'resolved'].includes(status)
  ) {
    return res.status(400).json({
      error: 'Invalid message status filter.'
    });
  }

  const values = [];
  let where = '';

  if (status && status !== 'all') {
    values.push(status);
    where = `WHERE status = $${values.length}`;
  }

  const countResult = await pool.query(
    `SELECT COUNT(*) AS total
     FROM contact_messages
     ${where}`,
    values
  );

  const listValues = [...values, limit, offset];

  const result = await pool.query(
    `SELECT
      id,
      name,
      email,
      subject,
      message,
      status,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
     FROM contact_messages
     ${where}
     ORDER BY created_at DESC
     LIMIT $${listValues.length - 1}
     OFFSET $${listValues.length}`,
    listValues
  );

  res.json({
    messages: result.rows,
    pagination: paginationMeta(
      page,
      limit,
      countResult.rows[0].total
    )
  });
}));



const updateMessageStatusHandler = asyncHandler(async (req, res) => {
  const messageId = Number(req.params.messageId);
  const status = String(req.body.status).trim();
  const adminId = adminIdFromRequest(req);

  const contactMessage = await withTransaction(pool, async (client) => {
    const result = await client.query(
      `UPDATE contact_messages
       SET status = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, status`,
      [status, messageId]
    );

    if (!result.rowCount) {
      return null;
    }

    await writeAuditLog(
      client,
      adminId,
      'contact_message',
      messageId,
      'status_updated',
      `Contact message status changed to ${status}.`
    );

    return result.rows[0];
  });

  if (!contactMessage) {
    return res.status(404).json({
      error: 'Contact message not found.'
    });
  }

  res.json({
    message: 'Message status updated.',
    contactMessage
  });
});

router.patch('/messages/:messageId/status', [
  param('messageId').isInt({ min: 1 }),
  body('status').isIn(['new', 'in_progress', 'resolved']),
  validateRequest
], updateMessageStatusHandler);

router.put('/messages/:messageId/status', [
  param('messageId').isInt({ min: 1 }),
  body('status').isIn(['new', 'in_progress', 'resolved']),
  validateRequest
], updateMessageStatusHandler);

return router;
}

module.exports = { createAdminRouter };
