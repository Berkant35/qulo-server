-- 052_anon_rpc_execute_iptal.sql
-- Derinlemesine savunma: public semadaki fonksiyonlarin anon/authenticated
-- EXECUTE yetkisini iptal et. 051 ile ayni sinif, AYRI adim (kendi baseline'i).
--
-- GEREKCE (canli olculdu, 2026-09-10):
--   * anon rolu public semadaki ~55 fonksiyonun cogunda EXECUTE yetkili.
--   * Cogu SECURITY INVOKER ve hedef tablosu RLS'li oldugundan zaten etkisiz,
--     AMA `increment_like_received`/`increment_times_shown` gibi fonksiyonlar
--     RLS'siz `users` tablosuna yaziyor → anon key ile cagrilinca herhangi bir
--     kullanicinin sayaclari sisirilir. `is_auth_email_verified` SECURITY DEFINER
--     ve anon'a acik → e-posta enumerasyon oracle'i (bugun auth.users bos oldugu
--     icin pratikte "false" donuyor, yine de kapatilmali).
--
-- NEDEN GUVENLI: Mobil (qulov2/lib) hicbir `.rpc()` cagrisi yapmiyor (grep=0);
--   qulo-server tek service_role client kullaniyor (rolbypassrls) ve EXECUTE'u
--   bu iptalden etkilenmez. Web quiz RPC'si (web_quiz_record_attempt) zaten
--   yalnizca service_role. Dolayisiyla hicbir uygulama yolu kirilmaz.
--
-- PUBLIC NEDEN DAHIL (2026-09-11 canli ACL okumasi): fonksiyonlarin ACL'i
--   {=X/postgres, anon=X, authenticated=X, service_role=X} — bastaki `=X` PUBLIC'e
--   verilmis EXECUTE. anon PUBLIC'in uyesi oldugu icin yalnizca anon/authenticated
--   REVOKE'u HICBIR SEY DEGISTIRMEZ; PUBLIC de iptal edilmeli. service_role kendi
--   acik grant'ini korur (kirmizi/yesil testle dogrulanir).
--
-- Geri alma: 052_anon_rpc_execute_iptal_rollback.sql

BEGIN;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Gelecekte olusturulacak fonksiyonlar da otomatik kapali gelsin.
-- GLOBAL (IN SCHEMA'siz) olmasi sart: per-schema default privilege'lar global
-- olanlara EKLENIR, onlari geri alamaz (pg_default_acl: postgres objtype=f
-- {anon=X, authenticated=X, ...} global girdi). Bu yuzden global girdi degistirilir.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
-- ...ve public semasina OZEL girdi de kapatilir: pg_default_acl'de postgres icin
-- ns=public girdisi {anon=X, authenticated=X} tasiyordu; sema-ozel girdiler global'e
-- EKLENDIGI icin yalnizca global REVOKE yeni fonksiyonlari kapatmadi (probe ile olculdu,
-- prod'da 052b olarak ayri uygulandi, 2026-09-11).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

COMMIT;

-- NOT: PostGIS (st_*) fonksiyonlari da kapanir; server service_role kullandigi
-- ve mobil bu fonksiyonlari cagirmadigi icin etkisi yoktur. Ileride anon'a acik
-- bir RPC gerekirse tek tek `GRANT EXECUTE ON FUNCTION public.<fn>(...) TO anon;`.
