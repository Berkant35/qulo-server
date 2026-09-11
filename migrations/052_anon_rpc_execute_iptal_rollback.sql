-- 052_anon_rpc_execute_iptal_rollback.sql
-- SADECE yesil (uygulama) testlerinde regresyon gorulurse calistirilir.
-- Bu, tum public fonksiyonlarin EXECUTE'unu anon/authenticated'e GERI VERIR.

BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  GRANT EXECUTE ON FUNCTIONS TO PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC, anon, authenticated;

COMMIT;
