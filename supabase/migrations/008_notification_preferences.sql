-- 008_notification_preferences.sql
-- Bildirim tercihleri: mesajlar, eşleşmeler, kampanyalar
ALTER TABLE users
ADD COLUMN IF NOT EXISTS notification_preferences JSONB
DEFAULT '{"messages": true, "matches": true, "campaigns": true}'::jsonb;

COMMENT ON COLUMN users.notification_preferences IS 'Push notification preferences per category. NULL = all enabled.';
