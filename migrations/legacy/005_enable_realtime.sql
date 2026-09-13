-- ============================================================
-- 005_enable_realtime.sql
-- Qulo V2 - Enable Supabase Realtime for messages table
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE messages;
