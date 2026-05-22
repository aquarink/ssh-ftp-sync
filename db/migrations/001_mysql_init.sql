CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  email VARCHAR(320) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY users_email_unique (email)
);

CREATE TABLE IF NOT EXISTS sessions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY sessions_token_hash_unique (token_hash),
  KEY sessions_user_id_index (user_id),
  KEY sessions_expires_at_index (expires_at),
  CONSTRAINT sessions_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hosts (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INT UNSIGNED NOT NULL DEFAULT 22,
  username VARCHAR(255) NOT NULL,
  password TEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY hosts_user_id_created_at_index (user_id, created_at),
  CONSTRAINT hosts_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
