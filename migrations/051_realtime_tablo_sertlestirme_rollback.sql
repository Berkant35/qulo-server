-- 051_realtime_tablo_sertlestirme_rollback.sql
-- SADECE yesil (uygulama) testlerinde regresyon gorulurse calistirilir:
--   * mobil cevrimici durum guncellenmiyor, YA DA
--   * sohbet realtime akisi kesildi.
-- DIKKAT: bu, anon rolune tam okuma + yazma yetkisini GERI VERIR (yani acigi
-- yeniden acar). Yalnizca gercek bir yesil regresyon KANITLANDIGINDA kullanilmali.

BEGIN;

-- Bolum B geri alma: users tam SELECT'i geri ver
REVOKE SELECT (id, is_online, last_seen_at) ON public.users FROM anon, authenticated;
GRANT  SELECT ON public.users TO anon, authenticated;

-- Bolum A geri alma: yazma yetkilerini geri ver
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.messages, public.matches, public.users
  TO anon, authenticated;

COMMIT;
