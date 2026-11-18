-- 086_whats_new_rollback.sql
-- "Yenilikler" pop-up tablosunu kaldirir. Veri kaybi: tum sürüm notlari silinir (yalniz backoffice icerigi).
-- Sunucu kodu tabloyu okuyamazsa istemciye { item: null } doner (pop-up gosterilmez); mobil etkilenmez.

BEGIN;

DROP TABLE IF EXISTS public.whats_new;

COMMIT;
