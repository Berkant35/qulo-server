-- 039_rls_a2_islem_tablolari_rollback.sql
-- SADECE yesil (uygulama) testlerinde regresyon gorulurse calistirilir.
-- Kirmizi testlerin fail'e donmesi HEDEFTIR, geri alma sebebi degildir.

ALTER TABLE public.diamond_transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.iap_transactions     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscriptions   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_sessions        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_answers         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.swipes               DISABLE ROW LEVEL SECURITY;
