-- 026_notification_locale_email.sql
-- Notification locale sync + match email
-- Created: 2026-06-09
-- Adds: users.last_active_at, users.email_notifications_enabled, email_unsubscribe_tokens

BEGIN;

-- 1) last_active_at: inactive owner tespiti için (match email decision)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

UPDATE users
  SET last_active_at = COALESCE(created_at, NOW())
  WHERE last_active_at IS NULL;

-- 2) email_notifications_enabled: opt-out kolonu (indexlenebilir tek alan)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN NOT NULL DEFAULT true;

-- 3) Inactive filtresi için index (24h+ owner sorgusu)
CREATE INDEX IF NOT EXISTS idx_users_last_active_at
  ON users(last_active_at);

-- 4) Unsubscribe token tablosu: revoke + audit
CREATE TABLE IF NOT EXISTS email_unsubscribe_tokens (
  token        TEXT PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_type   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_unsubscribe_tokens_user_id
  ON email_unsubscribe_tokens(user_id);

COMMIT;
