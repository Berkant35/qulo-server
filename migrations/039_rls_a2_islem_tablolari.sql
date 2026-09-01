-- 039_rls_a2_islem_tablolari.sql
-- RLS Guard / Parti A2 — kullanici islem ve oyun akisi tablolari.
--
-- GEREKCE: A1 (038) ile ayni. Anon key mobil binary'de gomulu ve bu tablolarin
-- tamami baseline testinde anon key ile okunabiliyordu. Ekonomi verisi
-- (diamond_transactions, user_subscriptions) ve oyun gecmisi (quiz_*, swipes)
-- disariya acik olmamali.
--
-- NEDEN GUVENLI (yapisal kanit, 2026-09-01):
--   * qulo-server'da src/config/supabase.ts DISINDA createClient YOK
--   * o tek client SUPABASE_SERVICE_ROLE_KEY kullaniyor
--   * server kodunda anon key kullanimi sifir
--   * service_role.rolbypassrls = true (pg_roles)
--   => RLS hicbir server kod yolunu etkileyemez (quiz.service.ts dahil)
-- Mobil bu tablolara dogrudan sorgu atmiyor; hicbiri supabase_realtime yayininda degil.
--
-- Geri alma: 039_rls_a2_islem_tablolari_rollback.sql

ALTER TABLE public.diamond_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iap_transactions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscriptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_answers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swipes               ENABLE ROW LEVEL SECURITY;
