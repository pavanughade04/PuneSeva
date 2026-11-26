
const bcrypt = require('bcryptjs');
const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const {
  asyncHandler,
  isActiveCondition,
  requireAuth,
  safeUser
} = require('../middleware/auth');

const BCRYPT_ROUNDS = 12;

const DASHBOARDS = {
  customer: '/customer-dashboard.html',
  provider: '/provider-dashboard.html'
};

function validateRequest(req, res, next) {
  const errors = validationResult(req);

  if (errors.isEmpty()) return next();

  return res.status(400).json({
    error: 'Please check the highlighted fields.',
    details: errors.array({ onlyFirstError: true }).map(
      ({ path, msg }) => ({ field: path, message: msg })
    )
  });
}

function passwordValidation(fieldName = 'password') {
  return body(fieldName)
    .isString().withMessage('Password is required.')
    .bail()
    .isLength({ min: 8, max: 72 })
    .withMessage('Password must be between 8 and 72 characters.')
    .bail()
    .custom((value) => Buffer.byteLength(value, 'utf8') <= 72)
    .withMessage('Password must be no more than 72 bytes when encoded.');
}

function cleanEmail(fieldName = 'email') {
  return body(fieldName)
    .trim()
    .isEmail().withMessage('Enter a valid email address.')
    .bail()
    .isLength({ max: 150 }).withMessage('Email address is too long.')
    .normalizeEmail({
      gmail_remove_dots: false,
      gmail_remove_subaddress: false
    })
    .customSanitizer((value) => value.toLowerCase());
}

function profileInsertFields(schema, userId, values) {
  const fields = [
    'user_id',
    'business_name',
    schema.experienceColumn,
    schema.areaColumn,
    schema.descriptionColumn,
    'approval_status'
  ];

  const valuesToInsert = [
    userId,
    values.businessName,
    values.experience,
    values.serviceArea,
    values.description,
    'pending'
  ];

  return { fields, valuesToInsert };
}

function placeholders(count, start = 1) {
  return Array.from(
    { length: count },
    (_, index) => `$${index + start}`
  ).join(', ');
}

function createLoginLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({
      error: 'Too many login attempts. Please try again in 15 minutes.'
    })
  });
}

const loginValidation = [
  cleanEmail(),
  body('password').isString().notEmpty()
    .withMessage('Password is required.'),
  validateRequest
];

function createLoginHandler(pool, schema, requiredRoles) {
  return asyncHandler(async (req, res) => {
    const roleCondition = ` AND role IN (${placeholders(requiredRoles.length, 2)})`;
    const values = [req.body.email, ...requiredRoles];

    const result = await pool.query(
      `SELECT id, full_name, email, role, password_hash
       FROM users
       WHERE email = $1
       AND ${isActiveCondition(schema)}${roleCondition}
       LIMIT 1`,
      values
    );

    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(req.body.password, user.password_hash))) {
      return res.status(401).json({
        error: 'Email or password is incorrect.'
      });
    }

    await new Promise((resolve, reject) => {
      req.session.regenerate((error) =>
        error ? reject(error) : resolve()
      );
    });

    req.session.user = safeUser(user);

    await new Promise((resolve, reject) => {
      req.session.save((error) =>
        error ? reject(error) : resolve()
      );
    });

    res.json({
      message: 'You are now logged in.',
      user: req.session.user,
      ...(DASHBOARDS[user.role]
        ? { redirectUrl: DASHBOARDS[user.role] }
        : {})
    });
  });
}

function createAdminLoginRouter({ pool, schema }) {
  const router = express.Router();

  router.post(
    '/',
    createLoginLimiter(),
    loginValidation,
    createLoginHandler(pool, schema, ['admin'])
  );

  return router;
}

function createAuthRouter({ pool, schema, sessionCookieName }) {
  const router = express.Router();

  router.post(
    '/login',
    createLoginLimiter(),
    loginValidation,
    createLoginHandler(pool, schema, ['customer', 'provider'])
  );

  // Customer registration
  router.post('/register', [
    body('fullName').trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Full name must be between 2 and 100 characters.'),

    cleanEmail(),

    body('phone').trim()
      .matches(/^\+?[1-9]\d{9,14}$/)
      .withMessage('Enter a valid mobile number with country code if needed.'),

    passwordValidation(),

    body('confirmPassword')
      .custom((value, { req }) => value === req.body.password)
      .withMessage('Passwords do not match.'),

    validateRequest
  ], asyncHandler(async (req, res) => {
    const passwordHash = await bcrypt.hash(
      req.body.password,
      BCRYPT_ROUNDS
    );

    const fields = [
      'full_name',
      'email',
      'password_hash',
      'phone',
      'role',
      'is_active'
    ];

    const values = [
      req.body.fullName,
      req.body.email,
      passwordHash,
      req.body.phone,
      'customer',
      true
    ];

    const client = await pool.connect();
    let transactionStarted = false;

    try {
      await client.query('BEGIN');
      transactionStarted = true;

      const result = await client.query(
        `INSERT INTO users (${fields.join(', ')})
         VALUES (${placeholders(fields.length)})
         RETURNING id`,
        values
      );

      const userId = Number(result.rows[0].id);

      await client.query(
        'INSERT INTO customer_profiles (user_id) VALUES ($1)',
        [userId]
      );

      await client.query('COMMIT');
      transactionStarted = false;

      res.status(201).json({
        message: 'Your account has been created. You can now log in.',
        user: {
          id: userId,
          fullName: req.body.fullName,
          email: req.body.email,
          role: 'customer'
        }
      });
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error(
            'Customer registration rollback failed:',
            rollbackError.message
          );
        }
      }

      if (error.code === '23505') {
        return res.status(409).json({
          error: 'An account with this email already exists.'
        });
      }

      throw error;
    } finally {
      client.release();
    }
  }));

  // Provider registration
  router.post('/provider-register', [
    body('fullName').trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Full name must be between 2 and 100 characters.'),

    cleanEmail(),

    body('phone').trim()
      .matches(/^\+?[1-9]\d{9,14}$/)
      .withMessage('Enter a valid mobile number with country code if needed.'),

    body('businessName').trim()
      .isLength({ min: 2, max: 150 })
      .withMessage('Business name must be between 2 and 150 characters.'),

    body('experience').isInt({ min: 0, max: 60 })
      .withMessage('Experience must be a whole number between 0 and 60 years.')
      .toInt(),

    body('serviceArea').trim()
      .isLength({ min: 2, max: 150 })
      .withMessage('Service area must be between 2 and 150 characters.'),

    body('description').trim()
      .isLength({ min: 20, max: 2000 })
      .withMessage('Description must be between 20 and 2,000 characters.'),

    passwordValidation(),

    body('confirmPassword')
      .custom((value, { req }) => value === req.body.password)
      .withMessage('Passwords do not match.'),

    validateRequest
  ], asyncHandler(async (req, res) => {
    const passwordHash = await bcrypt.hash(
      req.body.password,
      BCRYPT_ROUNDS
    );

    const userFields = [
      'full_name',
      'email',
      'password_hash',
      'phone',
      'role',
      'is_active'
    ];

    const userValues = [
      req.body.fullName,
      req.body.email,
      passwordHash,
      req.body.phone,
      'provider',
      true
    ];

    const client = await pool.connect();
    let transactionStarted = false;

    try {
      await client.query('BEGIN');
      transactionStarted = true;

      const userResult = await client.query(
        `INSERT INTO users (${userFields.join(', ')})
         VALUES (${placeholders(userFields.length)})
         RETURNING id`,
        userValues
      );

      const userId = Number(userResult.rows[0].id);

      const profile = profileInsertFields(schema, userId, {
        businessName: req.body.businessName,
        experience: req.body.experience,
        serviceArea: req.body.serviceArea,
        description: req.body.description
      });

      await client.query(
        `INSERT INTO provider_profiles (${profile.fields.join(', ')})
         VALUES (${placeholders(profile.fields.length)})`,
        profile.valuesToInsert
      );

      await client.query('COMMIT');
      transactionStarted = false;

      res.status(201).json({
        message: 'Your provider application has been submitted and is pending admin approval.',
        user: {
          id: userId,
          fullName: req.body.fullName,
          email: req.body.email,
          role: 'provider'
        },
        approvalStatus: 'pending'
      });
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error(
            'Provider registration rollback failed:',
            rollbackError.message
          );
        }
      }

      if (error.code === '23505') {
        return res.status(409).json({
          error: 'An account with this email already exists.'
        });
      }

      throw error;
    } finally {
      client.release();
    }
  }));

  // Logout
  router.post('/logout', asyncHandler(async (req, res) => {
    if (!req.session) {
      return res.json({ message: 'You are logged out.' });
    }

    await new Promise((resolve, reject) => {
      req.session.destroy((error) =>
        error ? reject(error) : resolve()
      );
    });

    res.clearCookie(sessionCookieName);

    res.json({ message: 'You are logged out.' });
  }));

  // Current logged-in user
  router.get(
    '/me',
    requireAuth(pool, schema),
    asyncHandler(async (req, res) => {
      const user = { ...req.user };

      if (user.role === 'provider') {
        const result = await pool.query(
          `SELECT approval_status
           FROM provider_profiles
           WHERE user_id = $1
           LIMIT 1`,
          [user.id]
        );

        user.approvalStatus =
          result.rows[0]?.approval_status || 'pending';
      }

      res.json({ user });
    })
  );

  return router;
}

module.exports = {
  createAdminLoginRouter,
  createAuthRouter
};
