
const express = require('express');
const { param, query, validationResult } = require('express-validator');
const { asyncHandler, isActiveCondition } = require('../middleware/auth');

function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  return res.status(400).json({
    error: 'Please check the provided filters.',
    details: errors.array({ onlyFirstError: true }).map(({ path, msg }) => ({
      field: path,
      message: msg
    }))
  });
}

function createServicesRouter({ pool, schema }) {
  const router = express.Router();

  router.get('/locations', asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT DISTINCT s.location
       FROM services AS s
       JOIN provider_profiles AS p ON p.user_id = s.provider_id
       JOIN users AS provider ON provider.id = p.user_id
       WHERE s.approval_status = $1
         AND s.is_available = TRUE
         AND p.approval_status = $2
         AND ${isActiveCondition(schema, 'provider')}
       ORDER BY s.location`,
      ['approved', 'approved']
    );

    res.json({
      locations: result.rows.map((row) => row.location)
    });
  }));

  router.get('/categories', asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT DISTINCT s.category
       FROM services AS s
       JOIN provider_profiles AS p ON p.user_id = s.provider_id
       JOIN users AS provider ON provider.id = p.user_id
       WHERE s.approval_status = $1
         AND s.is_available = TRUE
         AND p.approval_status = $2
         AND ${isActiveCondition(schema, 'provider')}
       ORDER BY s.category`,
      ['approved', 'approved']
    );

    res.json({
      categories: result.rows.map((row) => row.category)
    });
  }));

  router.get('/:serviceId', [
    param('serviceId')
      .isInt({ min: 1 })
      .withMessage('Service ID must be a positive integer.')
      .toInt(),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT
         s.id,
         s.service_name AS "serviceName",
         s.category,
         s.description,
         s.location,
         s.image,
         s.price,
         s.price_type AS "priceType",
         s.is_available AS "isAvailable",
         s.created_at AS "createdAt",
         p.user_id AS "providerId",
         provider.full_name AS "providerName",
         p.business_name AS "businessName",
         p.service_area AS "serviceArea"
       FROM services AS s
       JOIN provider_profiles AS p ON p.user_id = s.provider_id
       JOIN users AS provider ON provider.id = p.user_id
       WHERE s.id = $1
         AND s.approval_status = $2
         AND s.is_available = TRUE
         AND p.approval_status = $3
         AND ${isActiveCondition(schema, 'provider')}
       LIMIT 1`,
      [req.params.serviceId, 'approved', 'approved']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found.' });
    }

    res.json({
      service: {
        ...result.rows[0],
        isAvailable: Boolean(result.rows[0].isAvailable)
      }
    });
  }));

  router.get('/', [
    query('search')
      .optional()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Search text cannot exceed 100 characters.'),

    query('category')
      .optional()
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Category must be between 1 and 100 characters.'),

    query('location')
      .optional()
      .trim()
      .isLength({ min: 1, max: 160 })
      .withMessage('Location must be between 1 and 160 characters.'),

    query('sort')
      .optional()
      .isIn(['newest', 'price_asc', 'price_desc'])
      .withMessage('Choose newest, price_asc, or price_desc sorting.'),

    query('limit')
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage('Limit must be between 1 and 50.')
      .toInt(),

    validateRequest
  ], asyncHandler(async (req, res) => {
    const conditions = [
      's.approval_status = $1',
      's.is_available = TRUE',
      'p.approval_status = $2',
      isActiveCondition(schema, 'provider')
    ];

    const values = ['approved', 'approved'];

    if (req.query.category) {
      values.push(req.query.category);
      conditions.push(`s.category = $${values.length}`);
    }

    if (req.query.location) {
      values.push(`%${req.query.location}%`);
      conditions.push(`s.location ILIKE $${values.length}`);
    }

    if (req.query.search) {
      const searchTerm = `%${req.query.search}%`;

      const searchConditions = [
        's.service_name ILIKE',
        's.category ILIKE',
        's.description ILIKE',
        's.location ILIKE',
        'provider.full_name ILIKE',
        'p.business_name ILIKE'
      ].map((condition) => {
        values.push(searchTerm);
        return `${condition} $${values.length}`;
      });

      conditions.push(`(${searchConditions.join(' OR ')})`);
    }

    const orderBy = {
      newest: 's.created_at DESC, s.id DESC',
      price_asc: 's.price ASC, s.id ASC',
      price_desc: 's.price DESC, s.id DESC'
    }[req.query.sort || 'newest'];

    const limit = req.query.limit === undefined
      ? 24
      : Number(req.query.limit);

    values.push(limit);

    const result = await pool.query(
      `SELECT
         s.id,
         s.service_name AS "serviceName",
         s.category,
         s.description,
         s.location,
         s.image,
         s.price,
         s.price_type AS "priceType",
         s.is_available AS "isAvailable",
         s.created_at AS "createdAt",
         p.user_id AS "providerId",
         provider.full_name AS "providerName",
         p.business_name AS "businessName",
         p.service_area AS "serviceArea"
       FROM services AS s
       JOIN provider_profiles AS p ON p.user_id = s.provider_id
       JOIN users AS provider ON provider.id = p.user_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT $${values.length}`,
      values
    );

    res.json({
      services: result.rows.map((service) => ({
        ...service,
        isAvailable: Boolean(service.isAvailable)
      }))
    });
  }));

  return router;
}

module.exports = { createServicesRouter };
