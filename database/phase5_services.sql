USE pune_seva;

ALTER TABLE services
  ADD COLUMN location VARCHAR(160) NOT NULL DEFAULT 'Pune' AFTER description,
  ADD KEY idx_services_location (location);
