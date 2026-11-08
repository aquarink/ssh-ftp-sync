-- Plain ADD COLUMN: MySQL 8 has no IF NOT EXISTS for it. migrate.js records each
-- file once, so this never runs twice on a server that already applied it.
ALTER TABLE users
  ADD COLUMN legal_accepted_version VARCHAR(16) NULL AFTER email_checked_at,
  ADD COLUMN legal_accepted_at DATETIME(3) NULL AFTER legal_accepted_version;
