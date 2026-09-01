-- 040_rls_a3_katalog_config.sql
-- RLS Guard / Parti A3 — katalog, konfigurasyon ve icerik tablolari.
--
-- GEREKCE: A1/A2 ile ayni temel. Bu grup cogunlukla kisisel veri degil ama
-- `app_config` ve `powers` anon key ile YAZILABILIR durumdaydi (anon rolunun
-- UPDATE/DELETE yetkisi var) — yani ekonomi parametreleri disaridan
-- degistirilebilirdi. `questions` (234 satir) kullanici uretimi icerik.
--
-- NEDEN GUVENLI: qulo-server tek bir service_role client kullaniyor
-- (rolbypassrls=true), mobil bu tablolara dogrudan sorgu atmiyor, hicbiri
-- supabase_realtime yayininda degil. Yesil test seti bu partiden once
-- `app/config`, `app/economy`, `powers`, `page-messages` ile genisletildi.
--
-- Geri alma: 040_rls_a3_katalog_config_rollback.sql

ALTER TABLE public.questions                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_pending_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_question_suggestions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.powers                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iap_products             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_message_events      ENABLE ROW LEVEL SECURITY;
