USE pune_seva;

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
