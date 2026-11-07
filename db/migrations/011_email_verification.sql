ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at DATETIME(3) NULL AFTER email_checked_at;

-- Accounts that already exist were created before email verification. Mark them
-- verified so no current user is locked out by this release.
UPDATE users
   SET email_verified_at = UTC_TIMESTAMP(3)
 WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          CHAR(36)    PRIMARY KEY,
  user_id     CHAR(36)    NOT NULL,
  purpose     VARCHAR(32) NOT NULL DEFAULT 'signup',
  token_hash  CHAR(64)    NOT NULL,
  expires_at  DATETIME(3) NOT NULL,
  used_at     DATETIME(3) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY email_verification_tokens_hash_unique (token_hash),
  KEY email_verification_tokens_user_index (user_id),
  CONSTRAINT email_verification_tokens_user_foreign
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
