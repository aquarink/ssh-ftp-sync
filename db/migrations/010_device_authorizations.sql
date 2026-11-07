CREATE TABLE IF NOT EXISTS device_authorizations (
  id               CHAR(36)     PRIMARY KEY,
  device_code_hash CHAR(64)     NOT NULL,
  user_code        CHAR(8)      NOT NULL,
  status           ENUM('pending', 'approved', 'denied', 'consumed', 'expired') NOT NULL DEFAULT 'pending',
  user_id          CHAR(36)     NULL,
  runtime          VARCHAR(16)  NOT NULL DEFAULT 'electron',
  device_label     VARCHAR(120) NULL,
  app_version      VARCHAR(40)  NULL,
  requester_ip     VARCHAR(64)  NULL,
  approver_ip      VARCHAR(64)  NULL,
  poll_count       INT          NOT NULL DEFAULT 0,
  last_polled_at   DATETIME(3)  NULL,
  approved_at      DATETIME(3)  NULL,
  consumed_at      DATETIME(3)  NULL,
  expires_at       DATETIME(3)  NOT NULL,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY device_authorizations_device_code_hash_unique (device_code_hash),
  UNIQUE KEY device_authorizations_user_code_unique (user_code),
  KEY device_authorizations_expires_at_index (expires_at),
  KEY device_authorizations_requester_ip_index (requester_ip),
  CONSTRAINT device_authorizations_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Plain ADD COLUMN: MySQL 8 has no IF NOT EXISTS for it. migrate.js records each
-- file once, so the statement never runs twice.
ALTER TABLE sessions
  ADD COLUMN client       VARCHAR(16)  NOT NULL DEFAULT 'web' AFTER user_id,
  ADD COLUMN device_label VARCHAR(120) NULL AFTER client,
  ADD COLUMN last_seen_at DATETIME(3)  NULL AFTER expires_at;
