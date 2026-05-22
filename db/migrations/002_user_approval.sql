ALTER TABLE users
  ADD COLUMN username VARCHAR(64) NULL AFTER id,
  ADD COLUMN role ENUM('admin', 'user') NOT NULL DEFAULT 'user' AFTER password_hash,
  ADD COLUMN approval_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending' AFTER role,
  ADD COLUMN email_check_result VARCHAR(64) NULL AFTER approval_status,
  ADD COLUMN email_safe_to_send BOOLEAN NULL AFTER email_check_result,
  ADD COLUMN email_checked_at DATETIME(3) NULL AFTER email_safe_to_send,
  ADD UNIQUE KEY users_username_unique (username),
  ADD KEY users_approval_status_index (approval_status);

UPDATE users
   SET approval_status = 'approved'
 WHERE approval_status = 'pending';
