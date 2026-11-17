const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { asyncHandler } = require('../middleware/auth');

function createContactRouter({ pool }) {
  const router = express.Router();
  const contactLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: 'Too many messages were submitted. Please try again later.' })
  });

  router.post('/', contactLimiter, [
    body('name').isString().withMessage('Name is required.').bail().trim()
      .isLength({ min: 2, max: 120 }).withMessage('Name must be between 2 and 120 characters.'),
    body('email').isString().withMessage('Email is required.').bail().trim()
      .isEmail().withMessage('Enter a valid email address.')
      .isLength({ max: 254 }).withMessage('Email cannot exceed 254 characters.'),
    body('subject').isString().withMessage('Subject is required.').bail().trim()
      .isLength({ min: 3, max: 200 }).withMessage('Subject must be between 3 and 200 characters.'),
    body('message').isString().withMessage('Message is required.').bail().trim()
      .isLength({ min: 10, max: 5000 }).withMessage('Message must be between 10 and 5,000 characters.')
  ], asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Please check the provided information.',
        details: errors.array({ onlyFirstError: true }).map(({ path, msg }) => ({ field: path, message: msg }))
      });
    }

    await pool.execute(
      'INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)',
      [req.body.name, req.body.email, req.body.subject, req.body.message]
    );
    res.status(201).json({ message: 'Thanks. Your message has been received.' });
  }));

  return router;
}

module.exports = { createContactRouter };
