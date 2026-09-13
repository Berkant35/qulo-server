-- 018_media_requests_realtime.sql
-- media_requests tablosunu Supabase Realtime'a ekle

ALTER TABLE media_requests REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE media_requests;
