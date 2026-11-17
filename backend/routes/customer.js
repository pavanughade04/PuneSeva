const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { asyncHandler, isActiveCondition } = require('../middleware/auth');

function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  return res.status(400).json({
    error: 'Please check the provided information.',
    details: errors.array({ onlyFirstError: true }).map(({ path, msg }) => ({ field: path, message: msg }))
  });
}

function validPhone(value) {
  return value === '' || /^\+?[1-9]\d{9,14}$/.test(value);
}

function isFutureAppointment(date, time, now = new Date()) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const appointmentDate = new Date(Date.UTC(year, month - 1, day));
  if (
    appointmentDate.getUTCFullYear() !== year
    || appointmentDate.getUTCMonth() !== month - 1
    || appointmentDate.getUTCDate() !== day
  ) return false;

  const appointmentTime = Date.UTC(year, month - 1, day, hour, minute) - 330 * 60 * 1000;
  return appointmentTime > now.getTime();
}

function createCustomerRouter({ pool, schema }) {
  const router = express.Router();

  router.post('/bookings', [
    body('serviceId')
      .isInt({ min: 1 }).withMessage('Choose a valid service.')
      .toInt(),
    body('bookingDate')
      .isISO8601({ strict: true, strictSeparator: true })
      .withMessage('Enter a valid appointment date.'),
    body('bookingTime')
      .matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .withMessage('Enter a valid appointment time.'),
    body('address')
      .isString().withMessage('Service address is required.')
      .bail()
      .trim()
      .isLength({ min: 5, max: 500 }).withMessage('Service address must be between 5 and 500 characters.'),
    body('phone')
      .isString().withMessage('Contact number is required.')
      .bail()
      .trim()
      .matches(/^\+?[1-9]\d{9,14}$/).withMessage('Enter a valid contact number.'),
    body('notes')
      .optional({ values: 'null' })
      .isString().withMessage('Booking notes must be text.')
      .bail()
      .trim()
      .isLength({ max: 2000 }).withMessage('Booking notes cannot exceed 2,000 characters.'),
    validateRequest
  ], asyncHandler(async (req, res) => {
    if (!isFutureAppointment(req.body.bookingDate, req.body.bookingTime)) {
      return res.status(400).json({ error: 'Choose an appointment date and time in the future.' });
    }

    const connection = await pool.getConnection();
    let transactionStarted = false;
    try {
      await connection.beginTransaction();
      transactionStarted = true;
      const [serviceRows] = await connection.execute(
        `SELECT s.id, s.provider_id AS providerId, s.price
         FROM services AS s
         JOIN provider_profiles AS p ON p.user_id = s.provider_id
         JOIN users AS provider ON provider.id = p.user_id
         WHERE s.id = ?
           AND s.approval_status = 'approved'
           AND s.is_available = 1
           AND p.approval_status = 'approved'
           AND ${isActiveCondition(schema, 'provider')}
         LIMIT 1
         FOR UPDATE`,
        [req.body.serviceId]
      );
      if (serviceRows.length === 0) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(404).json({ error: 'This service is not currently available for booking.' });
      }

      const providerId = serviceRows[0].providerId;
      await connection.execute(
        'SELECT user_id FROM provider_profiles WHERE user_id = ? FOR UPDATE',
        [providerId]
      );

      const [conflicts] = await connection.execute(
        `SELECT id
         FROM bookings
         WHERE provider_id = ?
           AND booking_date = ?
           AND booking_time = ?
           AND status IN ('pending', 'accepted', 'in_progress')
         LIMIT 1`,
        [providerId, req.body.bookingDate, req.body.bookingTime]
      );
      if (conflicts.length > 0) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(409).json({ error: 'This provider already has a booking at that time. Choose another time.' });
      }

      const [result] = await connection.execute(
        `INSERT INTO bookings
           (customer_id, provider_id, service_id, booking_date, booking_time, address, customer_phone, description, total_amount, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          req.user.id,
          providerId,
          req.body.serviceId,
          req.body.bookingDate,
          req.body.bookingTime,
          req.body.address,
          req.body.phone,
          req.body.notes || null,
          serviceRows[0].price
        ]
      );
      await connection.commit();
      transactionStarted = false;

      return res.status(201).json({
        message: 'Your booking request has been sent to the provider.',
        booking: {
          id: Number(result.insertId),
          serviceId: Number(req.body.serviceId),
          providerId: Number(providerId),
          bookingDate: req.body.bookingDate,
          bookingTime: req.body.bookingTime,
          totalAmount: serviceRows[0].price,
          status: 'pending'
        }
      });
    } catch (error) {
      if (transactionStarted) await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }));

  router.get('/dashboard', asyncHandler(async (req, res) => {
    const [profileRows] = await pool.execute(
      `SELECT u.id, u.full_name AS fullName, u.email, u.phone, p.address, p.area, p.city
       FROM users AS u
       LEFT JOIN customer_profiles AS p ON p.user_id = u.id
       WHERE u.id = ?
       LIMIT 1`,
      [req.user.id]
    );
    const [bookingRows] = await pool.execute(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(status = 'pending'), 0) AS pending,
         COALESCE(SUM(status = 'completed'), 0) AS completed,
         COALESCE(SUM(status = 'cancelled'), 0) AS cancelled
       FROM bookings
       WHERE customer_id = ?`,
      [req.user.id]
    );

    res.json({
      user: profileRows[0],
      bookings: Object.fromEntries(
        Object.entries(bookingRows[0]).map(([key, value]) => [key, Number(value)])
      )
    });
  }));

  router.get('/profile', asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT u.id, u.full_name AS fullName, u.email, u.phone, p.address, p.area, p.city
       FROM users AS u
       LEFT JOIN customer_profiles AS p ON p.user_id = u.id
       WHERE u.id = ?
       LIMIT 1`,
      [req.user.id]
    );
    res.json({ profile: rows[0] });
  }));

  router.put('/profile', [
    body('fullName')
      .isString().withMessage('Full name is required.')
      .bail()
      .trim()
      .isLength({ min: 2, max: 100 }).withMessage('Full name must be between 2 and 100 characters.'),
    body('phone')
      .isString().withMessage('Phone number must be text.')
      .bail()
      .trim()
      .custom(validPhone).withMessage('Enter a valid phone number or leave it blank.')
  ], validateRequest, asyncHandler(async (req, res) => {
    const [result] = await pool.execute(
      'UPDATE users SET full_name = ?, phone = ? WHERE id = ?',
      [req.body.fullName, req.body.phone || null, req.user.id]
    );
    if (result.affectedRows !== 1) {
      return res.status(404).json({ error: 'Customer account not found.' });
    }

    res.json({
      message: 'Your profile has been updated.',
      profile: {
        id: req.user.id,
        fullName: req.body.fullName,
        email: req.user.email,
        phone: req.body.phone || null
      }
    });
  }));

  router.get('/bookings', asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT
         b.id,
         b.service_id AS serviceId,
         s.service_name AS serviceName,
         b.provider_id AS providerId,
         provider.full_name AS providerName,
         b.booking_date AS bookingDate,
         b.booking_time AS bookingTime,
         b.address,
         b.description,
         b.customer_phone AS customerPhone,
         b.rejection_reason AS rejectionReason,
         b.status,
         b.total_amount AS totalAmount,
         b.created_at AS createdAt
       FROM bookings AS b
       JOIN services AS s ON s.id = b.service_id
       JOIN users AS provider ON provider.id = b.provider_id
       WHERE b.customer_id = ?
       ORDER BY b.booking_date DESC, b.booking_time DESC, b.id DESC`,
      [req.user.id]
    );
    res.json({ bookings: rows });
  }));

  router.get('/bookings/:bookingId', [
    param('bookingId').isInt({ min: 1 }).withMessage('Booking ID must be a positive integer.').toInt(),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT
         b.id,
         b.service_id AS serviceId,
         s.service_name AS serviceName,
         s.category,
         b.provider_id AS providerId,
         provider.full_name AS providerName,
         b.booking_date AS bookingDate,
         b.booking_time AS bookingTime,
         b.address,
         b.description,
         b.customer_phone AS customerPhone,
         b.rejection_reason AS rejectionReason,
         b.status,
         b.total_amount AS totalAmount,
         b.created_at AS createdAt
       FROM bookings AS b
       JOIN services AS s ON s.id = b.service_id
       JOIN users AS provider ON provider.id = b.provider_id
       WHERE b.id = ? AND b.customer_id = ?
       LIMIT 1`,
      [req.params.bookingId, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Booking not found.' });
    res.json({ booking: rows[0] });
  }));

  router.put('/bookings/:bookingId/cancel', [
    param('bookingId').isInt({ min: 1 }).withMessage('Booking ID must be a positive integer.').toInt(),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const [result] = await pool.execute(
      `UPDATE bookings
       SET status = 'cancelled', status_updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND customer_id = ? AND status IN ('pending', 'accepted')`,
      [req.params.bookingId, req.user.id]
    );
    if (result.affectedRows === 1) {
      return res.json({ message: 'Your booking has been cancelled.' });
    }

    const [rows] = await pool.execute(
      'SELECT id FROM bookings WHERE id = ? AND customer_id = ? LIMIT 1',
      [req.params.bookingId, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Booking not found.' });
    return res.status(409).json({ error: 'This booking can no longer be cancelled.' });
  }));

  router.get('/reviews', asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT
         r.id,
         r.booking_id AS bookingId,
         r.rating,
         r.comment,
         r.created_at AS createdAt,
         s.service_name AS serviceName,
         provider.full_name AS providerName
       FROM reviews AS r
       JOIN bookings AS b
         ON b.id = r.booking_id
        AND b.customer_id = r.customer_id
        AND b.provider_id = r.provider_id
       JOIN services AS s ON s.id = b.service_id
       JOIN users AS provider ON provider.id = r.provider_id
       WHERE r.customer_id = ?
       ORDER BY r.created_at DESC, r.id DESC`,
      [req.user.id]
    );
    res.json({ reviews: rows });
  }));

  return router;
}

module.exports = { createCustomerRouter };
