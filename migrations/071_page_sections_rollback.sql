-- 071_page_sections_rollback.sql
-- 071'i geri alır. ÖNCE kodu geri al: getMe `has_reward_redemptions` seçer; market / olay / backoffice
-- bölüm tablolarını okur. Veri kaybı: tüm bölümler, kartlar, olaylar ve taleplerin kaynak kart bağı.

BEGIN;

SET LOCAL lock_timeout = '3s';

DROP FUNCTION IF EXISTS page_section_item_stats(TEXT, TIMESTAMPTZ);
ALTER TABLE reward_redemptions DROP COLUMN IF EXISTS source_item_id;
DROP TABLE IF EXISTS page_section_events;
DROP TABLE IF EXISTS page_section_items;
DROP TABLE IF EXISTS page_sections;
ALTER TABLE users DROP COLUMN IF EXISTS has_reward_redemptions;

COMMIT;
