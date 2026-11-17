CREATE DATABASE IF NOT EXISTS pune_seva
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE pune_seva;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(20) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('customer', 'provider', 'admin') NOT NULL,
  account_status ENUM('active', 'blocked') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role_status (role, account_status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customer_profiles (
  user_id BIGINT UNSIGNED NOT NULL,
  address VARCHAR(255) NULL,
  area VARCHAR(120) NULL,
  city VARCHAR(100) NOT NULL DEFAULT 'Pune',
  profile_image VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_customer_profiles_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS provider_profiles (
  user_id BIGINT UNSIGNED NOT NULL,
  business_name VARCHAR(160) NOT NULL,
  experience_years TINYINT UNSIGNED NOT NULL DEFAULT 0,
  service_area VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  address VARCHAR(255) NULL,
  city VARCHAR(100) NOT NULL DEFAULT 'Pune',
  profile_image VARCHAR(500) NULL,
  approval_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  KEY idx_provider_profiles_approval_city (approval_status, city),
  CONSTRAINT fk_provider_profiles_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS service_categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  description VARCHAR(500) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_service_categories_name (name),
  UNIQUE KEY uq_service_categories_slug (slug),
  KEY idx_service_categories_active (is_active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS services (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider_id BIGINT UNSIGNED NOT NULL,
  service_name VARCHAR(150) NOT NULL,
  category VARCHAR(100) NOT NULL,
  description TEXT NULL,
  location VARCHAR(160) NOT NULL DEFAULT 'Pune',
  image VARCHAR(500) NULL,
  price DECIMAL(10, 2) NOT NULL,
  price_type ENUM('fixed', 'hourly', 'starting_from') NOT NULL DEFAULT 'fixed',
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  approval_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_services_public (approval_status, is_available, category),
  KEY idx_services_provider (provider_id, created_at),
  KEY idx_services_price (price),
  KEY idx_services_location (location),
  CONSTRAINT fk_services_provider
    FOREIGN KEY (provider_id) REFERENCES provider_profiles (user_id) ON DELETE CASCADE,
  CONSTRAINT chk_services_price_nonnegative CHECK (price >= 0)
) ENGINE=InnoDB;

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
  status ENUM('pending', 'accepted', 'rejected', 'cancelled', 'in_progress', 'completed') NOT NULL DEFAULT 'pending',
  customer_phone VARCHAR(20) NOT NULL,
  rejection_reason VARCHAR(1000) NULL,
  status_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bookings_customer_status_date (customer_id, status, booking_date),
  KEY idx_bookings_provider_status_date (provider_id, status, booking_date),
  KEY idx_bookings_provider_slot (provider_id, booking_date, booking_time, status),
  KEY idx_bookings_service (service_id),
  CONSTRAINT fk_bookings_customer
    FOREIGN KEY (customer_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_provider
    FOREIGN KEY (provider_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_service
    FOREIGN KEY (service_id) REFERENCES services (id) ON DELETE RESTRICT,
  CONSTRAINT chk_bookings_total_amount_nonnegative CHECK (total_amount >= 0)
) ENGINE=InnoDB;

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
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS contact_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  status ENUM('new', 'in_progress', 'resolved') NOT NULL DEFAULT 'new',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_contact_messages_status_created (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id BIGINT UNSIGNED NOT NULL,
  entity_type VARCHAR(24) NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(32) NOT NULL,
  reason VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_admin_audit_entity (entity_type, entity_id, created_at),
  KEY idx_admin_audit_admin (admin_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS provider_availability (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider_id BIGINT UNSIGNED NOT NULL,
  day_of_week TINYINT UNSIGNED NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_provider_availability_slot (provider_id, day_of_week, start_time),
  KEY idx_provider_availability_day (day_of_week, is_available),
  CONSTRAINT fk_provider_availability_provider
    FOREIGN KEY (provider_id) REFERENCES provider_profiles (user_id) ON DELETE CASCADE,
  CONSTRAINT chk_provider_availability_day CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT chk_provider_availability_time CHECK (end_time > start_time)
) ENGINE=InnoDB;

INSERT INTO service_categories (name, slug, description) VALUES
  ('Electrician', 'electrician', 'Demo category for electrical repairs and installations.'),
  ('Plumber', 'plumber', 'Demo category for plumbing services.'),
  ('AC Repair', 'ac-repair', 'Demo category for air conditioning service and repair.'),
  ('Home Cleaning', 'home-cleaning', 'Demo category for home cleaning services.'),
  ('Painting', 'painting', 'Demo category for painting services.'),
  ('Carpenter', 'carpenter', 'Demo category for carpentry and furniture repairs.'),
  ('Home Appliance Repair', 'home-appliance-repair', 'Demo category for appliance service and repair.'),
  ('Pest Control', 'pest-control', 'Demo category for pest inspection and control.'),
  ('Tutor', 'tutor', 'Demo category for tutoring and academic support.'),
  ('Vehicle Repair', 'vehicle-repair', 'Demo category for vehicle service and repair.')
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  updated_at = CURRENT_TIMESTAMP;
