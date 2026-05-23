CREATE TABLE IF NOT EXISTS ssh_credentials (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  type ENUM('password', 'private_key', 'certificate', 'agent') NOT NULL,
  label VARCHAR(255) NOT NULL,
  username VARCHAR(255) NULL,
  fingerprint VARCHAR(255) NULL,
  storage_ref VARCHAR(255) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ssh_credentials_user_id_created_at_index (user_id, created_at),
  CONSTRAINT ssh_credentials_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

ALTER TABLE hosts
  ADD COLUMN auth_type ENUM('password', 'private_key', 'credential', 'agent', 'manual') NOT NULL DEFAULT 'password' AFTER username,
  ADD COLUMN credential_id CHAR(36) NULL AFTER auth_type,
  ADD KEY hosts_credential_id_index (credential_id),
  ADD CONSTRAINT hosts_credential_id_foreign
    FOREIGN KEY (credential_id) REFERENCES ssh_credentials (id) ON DELETE SET NULL;
