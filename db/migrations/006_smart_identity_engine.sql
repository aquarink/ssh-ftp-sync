ALTER TABLE ssh_credentials
  MODIFY COLUMN type ENUM('password', 'private_key', 'private_key_passphrase', 'key_pair', 'certificate', 'key_with_certificate', 'agent', 'one_time') NOT NULL;

ALTER TABLE hosts
  MODIFY COLUMN auth_type ENUM('password', 'private_key', 'private_key_passphrase', 'key_with_certificate', 'certificate', 'credential', 'identity', 'agent', 'manual', 'one_time') NOT NULL DEFAULT 'password';
