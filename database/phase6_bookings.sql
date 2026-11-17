USE pune_seva;

ALTER TABLE bookings
  MODIFY COLUMN status ENUM('pending', 'accepted', 'rejected', 'cancelled', 'in_progress', 'completed') NOT NULL DEFAULT 'pending',
  ADD COLUMN customer_phone VARCHAR(20) NULL AFTER address,
  ADD COLUMN rejection_reason VARCHAR(1000) NULL AFTER status,
  ADD KEY idx_bookings_provider_slot (provider_id, booking_date, booking_time, status);

UPDATE bookings AS b
JOIN users AS customer ON customer.id = b.customer_id
SET b.customer_phone = customer.phone
WHERE b.customer_phone IS NULL;
