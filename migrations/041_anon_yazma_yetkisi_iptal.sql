-- 041_anon_yazma_yetkisi_iptal.sql
-- RLS Guard / B-oncesi sertlestirme — messages, matches, users uzerinde
-- anon+authenticated yazma yetkisinin iptali.
--
-- SORUN: Bu uc tablo supabase_realtime yayininda oldugu icin policy'siz RLS
-- ACILAMAZ (chat teslimatini keser) ve A grubunun disinda birakildi. Ancak
-- olcum gosterdi ki anon rolu bu tablolarda yazma yetkisine sahip. Anon key
-- mobil binary'de gomulu oldugundan, key'i cikaran biri kullanici kayitlarini
-- veya tum mesajlari silebilir. Bu, RLS beklemeden kapatilabilecek en agir
-- vektor.
--
-- SELECT KORUNUYOR: Realtime postgres_changes teslimati okuma yetkisine
-- dayanir; SELECT alinirsa chat akisi kesilir. Yazma yetkileri okumadan
-- bagimsizdir, dolayisiyla bu migration teslimati etkilemez.
--
-- NEDEN GUVENLI (olculdu, 2026-09-01):
--   * mobil Supabase client'ini YALNIZCA realtime kanallari icin kullaniyor:
--     qulov2/lib altinda `.from()`, `.rpc()`, yazma ve storage cagrisi YOK
--     (foto yuklemesi server API'sine gidiyor: user_repository.dart:99
--     -> /users/me/photos)
--   * qulo-server tek service_role client kullaniyor (rolbypassrls=true),
--     grant degisikliginden etkilenmez
--
-- Geri alma: 041_anon_yazma_yetkisi_iptal_rollback.sql

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.messages, public.matches, public.users
  FROM anon, authenticated;
