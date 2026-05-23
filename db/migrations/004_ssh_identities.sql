ALTER TABLE ssh_credentials
  MODIFY COLUMN type ENUM('password', 'private_key', 'key_pair', 'certificate', 'key_with_certificate', 'agent', 'one_time') NOT NULL,
  ADD COLUMN public_key_fingerprint VARCHAR(255) NULL AFTER fingerprint,
  ADD COLUMN certificate_fingerprint VARCHAR(255) NULL AFTER public_key_fingerprint,
  ADD COLUMN notes TEXT NULL AFTER certificate_fingerprint;

ALTER TABLE hosts
  MODIFY COLUMN auth_type ENUM('password', 'private_key', 'credential', 'identity', 'agent', 'manual', 'one_time') NOT NULL DEFAULT 'password';
