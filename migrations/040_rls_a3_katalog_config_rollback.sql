-- 040_rls_a3_katalog_config_rollback.sql
-- SADECE yesil (uygulama) testlerinde regresyon gorulurse calistirilir.

ALTER TABLE public.questions                DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_pending_changes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_question_suggestions  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.powers                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.iap_products             DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_messages            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_message_events      DISABLE ROW LEVEL SECURITY;
