USE pune_seva;

ALTER TABLE services
  ADD COLUMN image VARCHAR(500) NULL AFTER location;
