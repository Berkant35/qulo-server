-- 038_rls_a1_hassas_tablolar_rollback.sql
-- 038'i geri alir. SADECE yesil (uygulama) testlerinde regresyon gorulurse
-- calistirilir — kirmizi testlerin fail'e donmesi HEDEFTIR, geri alma sebebi degildir.
-- Bkz. CLAUDE.md "Guvenlik Migration'lari — Kanit Temelli Adim Adim Kural".

ALTER TABLE public.refresh_tokens            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_details              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_feedback DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_unsubscribe_tokens  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocks                    DISABLE ROW LEVEL SECURITY;
