-- 067_rainbow_market_rollback.sql
-- UYARI: rainbow bakiyeleri ve itfa talepleri silinir. Enum degeri 'RAINBOW' Postgres'te
-- geri alinamaz; kalmasi zararsiz (eski kod o degeri yazmaz). RAINBOW defter satirlari silinir
-- ki eski istemci/servis tanimadigi turle karsilasmasin.
BEGIN;
DELETE FROM diamond_transactions WHERE type = 'RAINBOW';
DROP TABLE IF EXISTS reward_redemptions;
DROP TABLE IF EXISTS reward_catalog_items;
DROP TABLE IF EXISTS reward_market_countries;
ALTER TABLE diamond_transactions DROP COLUMN IF EXISTS paid_amount;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_purple_paid_le_purple;
ALTER TABLE users
  DROP COLUMN IF EXISTS rainbow_flagged_at,
  DROP COLUMN IF EXISTS rainbow_diamonds,
  DROP COLUMN IF EXISTS purple_paid;
COMMIT;
