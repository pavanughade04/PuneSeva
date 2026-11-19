
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

  const priceTypeExpression = schema?.services?.has('price_type')
    ? 's.price_type'
    : "'fixed'";

  router.get('/locations', asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT DISTINCT s.location
       FROM services AS s
       JOIN provider_profiles AS p ON p.user_id = s.provider_id
       JOIN users AS provider ON provider.id = p.user_id
       WHERE s.approval_status = ?
         AND s.is_available = 1
         AND p.approval_status = ?
         AND ${isActiveCondition(schema, 'provider')}
       ORDER BY s.location`,
      ['approved', 'approved']
    );

    res.json({
      locations: rows.map((row) => row.location)
    });
  }));

  router.get('/categories', asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT DISTINCT s.category
       FROM services AS s
       JOIN provider_profiles AS p ON p.user_id = s.provider_id
       JOIN users AS provider ON provider.id = p.user_id
       WHERE s.approval_status = ?
         AND s.is_available = 1
         AND p.approval_status = ?
         AND ${isActiveCondition(schema, 'provider')}
       ORDER BY s.category`,
      ['approved', 'approved']
    );

    res.json({
      categories: rows.map((row) => row.category)
    });
  }));

  router.get('/:serviceId', [
    param('serviceId')
      .isInt({ min: 1 })
      .withMessage('Service ID must be a positive integer.')
      .toInt(),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT
         s.id,
         s.service_name AS serviceName,
         s.category,
         s.description,
         s.location,
         s.image,
         s.price,
         ${priceTypeExpression} AS priceType,
         s.is_available AS isAvailable,
         s.created_at AS createdAt,
         p.user_id AS providerId,
         provider.full_name AS providerName,
         p.business_name AS businessName,
         p.service_area AS serviceArea
       FROM services AS s
       JOIN provider_profiles AS p ON p.user_id = s.provider_id
       JOIN users AS provider ON provider.id = p.user_id
       WHERE s.id = ?
         AND s.approval_status = ?
         AND s.is_available = 1
         AND p.approval_status = ?
         AND ${isActiveCondition(schema, 'provider')}
       LIMIT 1`,
      [req.params.serviceId, 'approved', 'approved']
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Service not found.' });
    }

    res.json({
      service: {
        ...rows[0],
        isAvailable: Boolean(rows[0].isAvailable)
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
      's.approval_status = ?',
      's.is_available = 1',
      'p.approval_status = ?',
      isActiveCondition(schema, 'provider')
    ];

    const values = ['approved', 'approved'];

    if (req.query.category) {
      conditions.push('s.category = ?');
      values.push(req.query.category);
    }

    if (req.query.location) {
      conditions.push('s.location LIKE ?');
      values.push(`%${req.query.location}%`);
    }

    if (req.query.search) {
      conditions.push(
        '(s.service_name LIKE ? OR s.category LIKE ? OR s.description LIKE ? OR s.location LIKE ? OR provider.full_name LIKE ? OR p.business_name LIKE ?)'
      );

      const searchTerm = `%${req.query.search}%`;

      values.push(
        searchTerm,
        searchTerm,
        searchTerm,
        searchTerm,
        searchTerm,
        searchTerm
      );
    }

    const orderBy = {
      newest: 's.created_at DESC, s.id DESC',
      price_asc: 's.price ASC, s.id ASC',
      price_desc: 's.price DESC, s.id DESC'
    }[req.query.sort || 'newest'];

    // LIMIT is converted to a validated integer.
    // It is inserted into SQL only after validation.
    const limit = req.query.limit === undefined
      ? 24
      : Number(req.query.limit);

    const [rows] = await pool.execute(
      `SELECT
         s.id,
         s.service_name AS serviceName,
         s.category,
         s.description,
         s.location,
         s.image,
         s.price,
         ${priceTypeExpression} AS priceType,
         s.is_available AS isAvailable,
         s.created_at AS createdAt,
         p.user_id AS providerId,
         provider.full_name AS providerName,
         p.business_name AS businessName,
         p.service_area AS serviceArea
       FROM services AS s
       JOIN provider_profiles AS p ON p.user_id = s.provider_id
       JOIN users AS provider ON provider.id = p.user_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT ${limit}`,
      values
    );

    res.json({
      services: rows.map((service) => ({
        ...service,
        isAvailable: Boolean(service.isAvailable)
      }))
    });
  }));

  return router;
}

module.exports = { createServicesRouter };
