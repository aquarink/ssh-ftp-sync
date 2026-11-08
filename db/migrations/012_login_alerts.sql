-- Plain ADD COLUMN: MySQL 8 has no IF NOT EXISTS for it (migrate.js runs each file once).
ALTER TABLE users
  ADD COLUMN login_alerts_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER email_verified_at;

CREATE TABLE IF NOT EXISTS user_known_ips (
  user_id       CHAR(36)    NOT NULL,
  ip            VARCHAR(64) NOT NULL,
  first_seen_at DATETIME(3) NOT NULL,
  last_seen_at  DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id, ip),
  CONSTRAINT user_known_ips_user_foreign
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Every outgoing message is recorded here. Counting today's `sent` rows gives the
-- daily cap that keeps the free SMTP2GO quota (200 a day) from running out silently.
CREATE TABLE IF NOT EXISTS email_outbox (
  id          CHAR(36)     PRIMARY KEY,
  recipient   VARCHAR(255) NOT NULL,
  template    VARCHAR(64)  NOT NULL,
  status      ENUM('sent', 'failed', 'deferred') NOT NULL,
  provider    VARCHAR(32)  NULL,
  last_error  VARCHAR(255) NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY email_outbox_created_index (created_at),
  KEY email_outbox_status_index (status, created_at)
);
