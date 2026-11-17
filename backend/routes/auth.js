const bcrypt = require('bcryptjs');
const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { asyncHandler, isActiveCondition, requireAuth, safeUser } = require('../middleware/auth');

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
    details: errors.array({ onlyFirstError: true }).map(({ path, msg }) => ({ field: path, message: msg }))
  });
}

function passwordValidation(fieldName = 'password') {
  return body(fieldName)
    .isString().withMessage('Password is required.')
    .bail()
    .isLength({ min: 8, max: 72 }).withMessage('Password must be between 8 and 72 characters.')
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
    .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false })
    .customSanitizer((value) => value.toLowerCase());
}

function profileInsertFields(schema, userId, values) {
  const fields = ['user_id', 'business_name', schema.experienceColumn, schema.areaColumn, schema.descriptionColumn, 'approval_status'];
  const valuesToInsert = [
    userId,
    values.businessName,
    values.experience,
    values.serviceArea,
    values.description,
    'pending'
  ];

  if (schema.providers.has('address')) {
    fields.splice(3, 0, 'address');
    valuesToInsert.splice(3, 0, values.serviceArea);
  }
  if (schema.providers.has('city')) {
    fields.splice(fields.length - 1, 0, 'city');
    valuesToInsert.splice(valuesToInsert.length - 1, 0, 'Pune');
  }

  return { fields, valuesToInsert };
}

function createLoginLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: 'Too many login attempts. Please try again in 15 minutes.' })
  });
}

const loginValidation = [
  cleanEmail(),
  body('password').isString().notEmpty().withMessage('Password is required.'),
  validateRequest
];

function createLoginHandler(pool, schema, requiredRoles) {
  return asyncHandler(async (req, res) => {
    const roleCondition = ` AND role IN (${requiredRoles.map(() => '?').join(', ')})`;
    const values = [req.body.email, ...requiredRoles];
    const [rows] = await pool.execute(
      `SELECT id, full_name, email, role, password_hash
       FROM users
       WHERE email = ? AND ${isActiveCondition(schema)}${roleCondition}
       LIMIT 1`,
      values
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(req.body.password, user.password_hash))) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }

    await new Promise((resolve, reject) => {
      req.session.regenerate((error) => error ? reject(error) : resolve());
    });
    req.session.user = safeUser(user);
    await new Promise((resolve, reject) => {
      req.session.save((error) => error ? reject(error) : resolve());
    });

    res.json({
      message: 'You are now logged in.',
      user: req.session.user,
      ...(DASHBOARDS[user.role] ? { redirectUrl: DASHBOARDS[user.role] } : {})
    });
  });
}

function createAdminLoginRouter({ pool, schema }) {
  const router = express.Router();
  router.post('/', createLoginLimiter(), loginValidation, createLoginHandler(pool, schema, ['admin']));
  return router;
}

function createAuthRouter({ pool, schema, sessionCookieName }) {
  const router = express.Router();

  router.post('/login', createLoginLimiter(), loginValidation, createLoginHandler(pool, schema, ['customer', 'provider']));

  router.post('/register', [
    body('fullName').trim().isLength({ min: 2, max: 100 }).withMessage('Full name must be between 2 and 100 characters.'),
    cleanEmail(),
    body('phone')
      .trim()
      .matches(/^\+?[1-9]\d{9,14}$/).withMessage('Enter a valid mobile number with country code if needed.'),
    passwordValidation(),
    body('confirmPassword').custom((value, { req }) => value === req.body.password)
      .withMessage('Passwords do not match.'),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const passwordHash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
    const fields = ['full_name', 'email', 'password_hash', 'role'];
    const values = [req.body.fullName, req.body.email, passwordHash, 'customer'];
    if (schema.users.has('phone')) {
      fields.push('phone');
      values.push(req.body.phone);
    }
    if (schema.users.has('account_status')) {
      fields.push('account_status');
      values.push('active');
    } else if (schema.users.has('is_active')) {
      fields.push('is_active');
      values.push(1);
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const placeholders = fields.map(() => '?').join(', ');
      const [result] = await connection.execute(
        `INSERT INTO users (${fields.join(', ')}) VALUES (${placeholders})`,
        values
      );

      if (schema.customerProfiles) {
        await connection.execute(
          'INSERT INTO customer_profiles (user_id) VALUES (?)',
          [result.insertId]
        );
      }
      await connection.commit();
      res.status(201).json({
        message: 'Your account has been created. You can now log in.',
        user: { id: Number(result.insertId), fullName: req.body.fullName, email: req.body.email, role: 'customer' }
      });
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
      throw error;
    } finally {
      connection.release();
    }
  }));

  router.post('/provider-register', [
    body('fullName').trim().isLength({ min: 2, max: 100 }).withMessage('Full name must be between 2 and 100 characters.'),
    cleanEmail(),
    body('phone')
      .trim()
      .matches(/^\+?[1-9]\d{9,14}$/).withMessage('Enter a valid mobile number with country code if needed.'),
    body('businessName').trim().isLength({ min: 2, max: 150 }).withMessage('Business name must be between 2 and 150 characters.'),
    body('experience').isInt({ min: 0, max: 60 }).withMessage('Experience must be a whole number between 0 and 60 years.').toInt(),
    body('serviceArea').trim().isLength({ min: 2, max: 150 }).withMessage('Service area must be between 2 and 150 characters.'),
    body('description').trim().isLength({ min: 20, max: 2000 }).withMessage('Description must be between 20 and 2,000 characters.'),
    passwordValidation(),
    body('confirmPassword').custom((value, { req }) => value === req.body.password)
      .withMessage('Passwords do not match.'),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const passwordHash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
    const userFields = ['full_name', 'email', 'password_hash', 'role'];
    const userValues = [req.body.fullName, req.body.email, passwordHash, 'provider'];
    if (schema.users.has('phone')) {
      userFields.push('phone');
      userValues.push(req.body.phone);
    }
    if (schema.users.has('account_status')) {
      userFields.push('account_status');
      userValues.push('active');
    } else if (schema.users.has('is_active')) {
      userFields.push('is_active');
      userValues.push(1);
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [userResult] = await connection.execute(
        `INSERT INTO users (${userFields.join(', ')}) VALUES (${userFields.map(() => '?').join(', ')})`,
        userValues
      );

      const profile = profileInsertFields(schema, userResult.insertId, {
        businessName: req.body.businessName,
        experience: req.body.experience,
        serviceArea: req.body.serviceArea,
        description: req.body.description
      });
      await connection.execute(
        `INSERT INTO provider_profiles (${profile.fields.join(', ')})
         VALUES (${profile.fields.map(() => '?').join(', ')})`,
        profile.valuesToInsert
      );
      await connection.commit();

      res.status(201).json({
        message: 'Your provider application has been submitted and is pending admin approval.',
        user: { id: Number(userResult.insertId), fullName: req.body.fullName, email: req.body.email, role: 'provider' },
        approvalStatus: 'pending'
      });
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
      throw error;
    } finally {
      connection.release();
    }
  }));

  router.post('/logout', asyncHandler(async (req, res) => {
    if (!req.session) return res.json({ message: 'You are logged out.' });
    await new Promise((resolve, reject) => {
      req.session.destroy((error) => error ? reject(error) : resolve());
    });
    res.clearCookie(sessionCookieName);
    res.json({ message: 'You are logged out.' });
  }));

  router.get('/me', requireAuth(pool, schema), asyncHandler(async (req, res) => {
    const user = { ...req.user };
    if (user.role === 'provider') {
      const [rows] = await pool.execute(
        'SELECT approval_status FROM provider_profiles WHERE user_id = ? LIMIT 1',
        [user.id]
      );
      user.approvalStatus = rows[0]?.approval_status || 'pending';
    }
    res.json({ user });
  }));

  return router;
}

module.exports = { createAdminLoginRouter, createAuthRouter };
