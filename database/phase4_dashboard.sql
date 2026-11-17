USE pune_seva;

CREATE TABLE IF NOT EXISTS bookings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  provider_id BIGINT UNSIGNED NOT NULL,
  service_id BIGINT UNSIGNED NOT NULL,
  booking_date DATE NOT NULL,
  booking_time TIME NOT NULL,
  address VARCHAR(500) NOT NULL,
  description TEXT NULL,
  total_amount DECIMAL(10, 2) NOT NULL,
  status ENUM('pending', 'accepted', 'rejected', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
  status_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bookings_customer_status_date (customer_id, status, booking_date),
  KEY idx_bookings_provider_status_date (provider_id, status, booking_date),
  KEY idx_bookings_service (service_id),
  CONSTRAINT fk_bookings_customer_user
    FOREIGN KEY (customer_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_provider_user
    FOREIGN KEY (provider_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_service
    FOREIGN KEY (service_id) REFERENCES services (id) ON DELETE RESTRICT,
  CONSTRAINT chk_bookings_total_amount_nonnegative CHECK (total_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL,
  provider_id BIGINT UNSIGNED NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  comment VARCHAR(2000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reviews_booking (booking_id),
  KEY idx_reviews_customer_created (customer_id, created_at),
  KEY idx_reviews_provider_created (provider_id, created_at),
  CONSTRAINT fk_reviews_booking
    FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_customer_user
    FOREIGN KEY (customer_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_reviews_provider_user
    FOREIGN KEY (provider_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_reviews_rating_range CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
