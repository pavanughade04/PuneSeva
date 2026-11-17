const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { asyncHandler } = require('../middleware/auth');
const { removeServiceImage, uploadServiceImage } = require('../middleware/service-image-upload');

const PRICE_TYPES = ['fixed', 'hourly', 'starting_from'];
const BOOKING_TRANSITIONS = {
  pending: ['accepted', 'rejected'],
  accepted: ['in_progress'],
  in_progress: ['completed']
};

function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  if (req.file?.filename) {
    removeServiceImage(req.file.filename)
      .catch((error) => console.error('Could not remove rejected service image:', error.message));
  }

  return res.status(400).json({
    error: 'Please check the provided information.',
    details: errors.array({ onlyFirstError: true }).map(({ path, msg }) => ({ field: path, message: msg }))
  });
}

function textField(field, min, max, label) {
  return body(field)
    .isString().withMessage(`${label} is required.`)
    .bail()
    .trim()
    .isLength({ min, max }).withMessage(`${label} must be between ${min} and ${max} characters.`);
}

function serviceValidation() {
  return [
    textField('serviceName', 2, 150, 'Service name'),
    textField('category', 2, 100, 'Category'),
    body('description')
      .optional({ values: 'null' })
      .isString().withMessage('Description must be text.')
      .bail()
      .trim()
      .isLength({ max: 2000 }).withMessage('Description cannot exceed 2,000 characters.'),
    textField('location', 2, 160, 'Service location'),
    body('price')
      .isFloat({ min: 0, max: 99999999.99 }).withMessage('Price must be a non-negative amount.')
      .toFloat(),
    body('priceType')
      .isIn(PRICE_TYPES).withMessage('Choose fixed, hourly, or starting from pricing.'),
    body('isAvailable')
      .isBoolean().withMessage('Availability must be true or false.')
      .toBoolean()
  ];
}

function validPhone(value) {
  return value === '' || /^\+?[1-9]\d{9,14}$/.test(value);
}

function createProviderRouter({ pool, schema }) {
  const router = express.Router();
  const hasPriceType = schema?.services?.has('price_type') !== false;
  const priceTypeExpression = hasPriceType ? 'price_type' : "'fixed'";

  async function getProviderProfile(userId) {
    const [rows] = await pool.execute(
      `SELECT
         u.id,
         u.full_name AS fullName,
         u.email,
         u.phone,
         p.business_name AS businessName,
         p.experience_years AS experience,
         p.service_area AS serviceArea,
         p.description,
         p.approval_status AS approvalStatus
       FROM users AS u
       JOIN provider_profiles AS p ON p.user_id = u.id
       WHERE u.id = ?
       LIMIT 1`,
      [userId]
    );
    return rows[0];
  }

  router.get('/dashboard', asyncHandler(async (req, res) => {
    const profile = await getProviderProfile(req.user.id);
    if (!profile) return res.status(404).json({ error: 'Provider profile not found.' });

    const [serviceRows] = await pool.execute(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(approval_status = 'approved'), 0) AS approved,
         COALESCE(SUM(approval_status = 'pending'), 0) AS pending,
         COALESCE(SUM(approval_status = 'rejected'), 0) AS rejected
       FROM services
       WHERE provider_id = ?`,
      [req.user.id]
    );
    const [bookingRows] = await pool.execute(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(status = 'pending'), 0) AS pending,
         COALESCE(SUM(status = 'completed'), 0) AS completed
       FROM bookings
       WHERE provider_id = ?`,
      [req.user.id]
    );

    res.json({
      user: profile,
      services: Object.fromEntries(
        Object.entries(serviceRows[0]).map(([key, value]) => [key, Number(value)])
      ),
      bookings: Object.fromEntries(
        Object.entries(bookingRows[0]).map(([key, value]) => [key, Number(value)])
      )
    });
  }));

  router.get('/profile', asyncHandler(async (req, res) => {
    const profile = await getProviderProfile(req.user.id);
    if (!profile) return res.status(404).json({ error: 'Provider profile not found.' });
    res.json({ profile });
  }));

  router.put('/profile', [
    textField('fullName', 2, 100, 'Full name'),
    body('phone')
      .isString().withMessage('Phone number must be text.')
      .bail()
      .trim()
      .custom(validPhone).withMessage('Enter a valid phone number or leave it blank.'),
    textField('businessName', 2, 150, 'Business name'),
    body('experience')
      .isInt({ min: 0, max: 60 }).withMessage('Experience must be a whole number between 0 and 60.')
      .toInt(),
    textField('serviceArea', 2, 150, 'Service area'),
    textField('description', 20, 2000, 'Business description')
  ], validateRequest, asyncHandler(async (req, res) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existingProfiles] = await connection.execute(
        'SELECT u.id FROM users AS u JOIN provider_profiles AS p ON p.user_id = u.id WHERE u.id = ? AND u.role = ? FOR UPDATE',
        [req.user.id, 'provider']
      );
      if (existingProfiles.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: 'Provider profile not found.' });
      }

      await connection.execute(
        'UPDATE users SET full_name = ?, phone = ? WHERE id = ? AND role = ?',
        [req.body.fullName, req.body.phone || null, req.user.id, 'provider']
      );
      await connection.execute(
        `UPDATE provider_profiles
         SET business_name = ?, experience_years = ?, service_area = ?, description = ?
         WHERE user_id = ?`,
        [req.body.businessName, req.body.experience, req.body.serviceArea, req.body.description, req.user.id]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    res.json({
      message: 'Your provider profile has been updated.',
      profile: await getProviderProfile(req.user.id)
    });
  }));

  router.get('/services', asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT
         id,
         service_name AS serviceName,
         category,
         description,
         location,
         image,
         price,
         ${priceTypeExpression} AS priceType,
         is_available AS isAvailable,
         approval_status AS approvalStatus,
         created_at AS createdAt
       FROM services
       WHERE provider_id = ?
       ORDER BY created_at DESC, id DESC`,
      [req.user.id]
    );
    res.json({
      services: rows.map((service) => ({ ...service, isAvailable: Boolean(service.isAvailable) }))
    });
  }));

  router.post('/services', uploadServiceImage, serviceValidation(), validateRequest, asyncHandler(async (req, res) => {
    const [providers] = await pool.execute(
      'SELECT approval_status FROM provider_profiles WHERE user_id = ? LIMIT 1',
      [req.user.id]
    );
    if (providers.length === 0) {
      if (req.file) await removeServiceImage(req.file.filename);
      return res.status(404).json({ error: 'Provider profile not found.' });
    }
    if (req.body.isAvailable && providers[0].approval_status !== 'approved') {
      if (req.file) await removeServiceImage(req.file.filename);
      return res.status(403).json({ error: 'Your provider account must be approved before you can activate a service.' });
    }

    let result;
    try {
      const fields = [
        'provider_id', 'service_name', 'category', 'description', 'location', 'image', 'price',
        ...(hasPriceType ? ['price_type'] : []),
        'is_available', 'approval_status'
      ];
      const values = [
        req.user.id,
        req.body.serviceName,
        req.body.category,
        req.body.description || null,
        req.body.location,
        req.file?.imageUrl || null,
        req.body.price,
        ...(hasPriceType ? [req.body.priceType] : []),
        req.body.isAvailable ? 1 : 0
      ];
      [result] = await pool.execute(
        `INSERT INTO services (${fields.join(', ')})
         VALUES (${fields.slice(0, -1).map(() => '?').join(', ')}, 'pending')`,
        values
      );
    } catch (error) {
      if (req.file) {
        await removeServiceImage(req.file.filename)
          .catch((cleanupError) => console.error('Could not remove unsaved service image:', cleanupError.message));
      }
      throw error;
    }

    res.status(201).json({
      message: 'Service saved. It will appear publicly after service approval.',
      service: {
        id: Number(result.insertId),
        serviceName: req.body.serviceName,
        category: req.body.category,
        description: req.body.description || null,
        location: req.body.location,
        image: req.file?.imageUrl || null,
        price: req.body.price,
        priceType: req.body.priceType,
        isAvailable: req.body.isAvailable,
        approvalStatus: 'pending'
      }
    });
  }));

  router.put('/services/:serviceId', [
    uploadServiceImage,
    param('serviceId').isInt({ min: 1 }).withMessage('Service ID must be a positive integer.').toInt(),
    ...serviceValidation()
  ], validateRequest, asyncHandler(async (req, res) => {
    const [providers] = await pool.execute(
      'SELECT approval_status FROM provider_profiles WHERE user_id = ? LIMIT 1',
      [req.user.id]
    );
    if (providers.length === 0) {
      if (req.file) await removeServiceImage(req.file.filename);
      return res.status(404).json({ error: 'Provider profile not found.' });
    }
    if (req.body.isAvailable && providers[0].approval_status !== 'approved') {
      if (req.file) await removeServiceImage(req.file.filename);
      return res.status(403).json({ error: 'Your provider account must be approved before you can activate a service.' });
    }

    const [existingRows] = await pool.execute(
      'SELECT image FROM services WHERE id = ? AND provider_id = ? LIMIT 1',
      [req.params.serviceId, req.user.id]
    );
    if (existingRows.length === 0) {
      if (req.file) await removeServiceImage(req.file.filename);
      return res.status(404).json({ error: 'Service not found.' });
    }

    let result;
    try {
      const priceTypeUpdate = hasPriceType ? 'price_type = ?, ' : '';
      const updateValues = [
        req.body.serviceName,
        req.body.category,
        req.body.description || null,
        req.body.location,
        req.file?.imageUrl || existingRows[0].image,
        req.body.price,
        ...(hasPriceType ? [req.body.priceType] : []),
        req.body.isAvailable ? 1 : 0,
        req.params.serviceId,
        req.user.id
      ];
      [result] = await pool.execute(
        `UPDATE services
         SET service_name = ?, category = ?, description = ?, location = ?, image = ?, price = ?, ${priceTypeUpdate}is_available = ?,
             approval_status = 'pending'
         WHERE id = ? AND provider_id = ?`,
        updateValues
      );
    } catch (error) {
      if (req.file) {
        await removeServiceImage(req.file.filename)
          .catch((cleanupError) => console.error('Could not remove unsaved service image:', cleanupError.message));
      }
      throw error;
    }
    if (result.affectedRows !== 1) {
      const [rows] = await pool.execute(
        'SELECT id FROM services WHERE id = ? AND provider_id = ? LIMIT 1',
        [req.params.serviceId, req.user.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Service not found.' });
    }

    const [rows] = await pool.execute(
      `SELECT
         id,
         service_name AS serviceName,
         category,
         description,
         location,
         image,
         price,
         ${priceTypeExpression} AS priceType,
         is_available AS isAvailable,
         approval_status AS approvalStatus,
         created_at AS createdAt
       FROM services
       WHERE id = ? AND provider_id = ?
       LIMIT 1`,
      [req.params.serviceId, req.user.id]
    );
    res.json({
      message: 'Service updated and submitted for approval.',
      service: { ...rows[0], isAvailable: Boolean(rows[0].isAvailable) }
    });
    if (req.file && existingRows[0].image && existingRows[0].image !== req.file.imageUrl) {
      const oldFilename = existingRows[0].image.split('/').pop();
      await removeServiceImage(oldFilename)
        .catch((error) => console.error('Could not remove replaced service image:', error.message));
    }
  }));

  router.patch('/services/:serviceId/availability', [
    param('serviceId').isInt({ min: 1 }).withMessage('Service ID must be a positive integer.').toInt(),
    body('isAvailable')
      .isBoolean().withMessage('Availability must be true or false.')
      .toBoolean(),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const [providers] = await pool.execute(
      'SELECT approval_status FROM provider_profiles WHERE user_id = ? LIMIT 1',
      [req.user.id]
    );
    if (providers.length === 0) return res.status(404).json({ error: 'Provider profile not found.' });
    if (req.body.isAvailable && providers[0].approval_status !== 'approved') {
      return res.status(403).json({ error: 'Your provider account must be approved before you can activate a service.' });
    }

    const [result] = await pool.execute(
      `UPDATE services
       SET is_available = ?
       WHERE id = ? AND provider_id = ?`,
      [req.body.isAvailable ? 1 : 0, req.params.serviceId, req.user.id]
    );
    if (result.affectedRows !== 1) {
      const [rows] = await pool.execute(
        'SELECT id FROM services WHERE id = ? AND provider_id = ? LIMIT 1',
        [req.params.serviceId, req.user.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Service not found.' });
    }

    res.json({
      message: req.body.isAvailable ? 'Service activated.' : 'Service deactivated.',
      service: { id: req.params.serviceId, isAvailable: req.body.isAvailable }
    });
  }));

  router.delete('/services/:serviceId', [
    param('serviceId').isInt({ min: 1 }).withMessage('Service ID must be a positive integer.').toInt(),
    validateRequest
  ], asyncHandler(async (req, res) => {
    try {
      const [serviceRows] = await pool.execute(
        'SELECT image FROM services WHERE id = ? AND provider_id = ? LIMIT 1',
        [req.params.serviceId, req.user.id]
      );
      if (serviceRows.length === 0) return res.status(404).json({ error: 'Service not found.' });

      const [result] = await pool.execute(
        'DELETE FROM services WHERE id = ? AND provider_id = ?',
        [req.params.serviceId, req.user.id]
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Service not found.' });
      if (serviceRows[0].image) {
        const filename = serviceRows[0].image.split('/').pop();
        await removeServiceImage(filename)
          .catch((error) => console.error('Could not remove deleted service image:', error.message));
      }
      return res.json({ message: 'Service deleted.' });
    } catch (error) {
      if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === 'ER_ROW_IS_REFERENCED') {
        return res.status(409).json({ error: 'This service has booking history and cannot be deleted.' });
      }
      throw error;
    }
  }));

  router.get('/bookings', asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT
         b.id,
         b.customer_id AS customerId,
         customer.full_name AS customerName,
         b.customer_phone AS customerPhone,
         b.service_id AS serviceId,
         s.service_name AS serviceName,
         b.booking_date AS bookingDate,
         b.booking_time AS bookingTime,
         b.address,
         b.description,
         b.rejection_reason AS rejectionReason,
         b.status,
         b.total_amount AS totalAmount,
         b.created_at AS createdAt
       FROM bookings AS b
       JOIN services AS s ON s.id = b.service_id AND s.provider_id = b.provider_id
       JOIN users AS customer ON customer.id = b.customer_id
       WHERE b.provider_id = ?
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
         b.customer_id AS customerId,
         customer.full_name AS customerName,
         b.customer_phone AS customerPhone,
         b.service_id AS serviceId,
         s.service_name AS serviceName,
         s.category,
         b.booking_date AS bookingDate,
         b.booking_time AS bookingTime,
         b.address,
         b.description,
         b.rejection_reason AS rejectionReason,
         b.status,
         b.total_amount AS totalAmount,
         b.created_at AS createdAt
       FROM bookings AS b
       JOIN services AS s ON s.id = b.service_id AND s.provider_id = b.provider_id
       JOIN users AS customer ON customer.id = b.customer_id
       WHERE b.id = ? AND b.provider_id = ?
       LIMIT 1`,
      [req.params.bookingId, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Booking not found.' });
    res.json({ booking: rows[0] });
  }));

  router.put('/bookings/:bookingId/status', [
    param('bookingId').isInt({ min: 1 }).withMessage('Booking ID must be a positive integer.').toInt(),
    body('status')
      .isIn(['accepted', 'rejected', 'in_progress', 'completed'])
      .withMessage('Choose accepted, rejected, in_progress, or completed.'),
    body('rejectionReason')
      .if(body('status').equals('rejected'))
      .isString().withMessage('A rejection reason is required.')
      .bail()
      .trim()
      .isLength({ min: 5, max: 1000 }).withMessage('Rejection reason must be between 5 and 1,000 characters.'),
    validateRequest
  ], asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      'SELECT status FROM bookings WHERE id = ? AND provider_id = ? LIMIT 1',
      [req.params.bookingId, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Booking not found.' });
    if (!BOOKING_TRANSITIONS[rows[0].status]?.includes(req.body.status)) {
      return res.status(409).json({ error: `A ${rows[0].status} booking cannot be changed to ${req.body.status}.` });
    }

    const [result] = await pool.execute(
      `UPDATE bookings
       SET status = ?, rejection_reason = ?, status_updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND provider_id = ? AND status = ?`,
      [
        req.body.status,
        req.body.status === 'rejected' ? req.body.rejectionReason.trim() : null,
        req.params.bookingId,
        req.user.id,
        rows[0].status
      ]
    );
    if (result.affectedRows !== 1) {
      return res.status(409).json({ error: 'The booking changed before your update was saved. Refresh and try again.' });
    }

    res.json({ message: 'Booking status updated.', booking: { id: Number(req.params.bookingId), status: req.body.status } });
  }));

  return router;
}

module.exports = { createProviderRouter };
