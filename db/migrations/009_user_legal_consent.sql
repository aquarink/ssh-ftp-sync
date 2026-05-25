ALTER TABLE users
  ADD COLUMN legal_accepted_version VARCHAR(16) NULL AFTER email_checked_at,
  ADD COLUMN legal_accepted_at DATETIME(3) NULL AFTER legal_accepted_version;
