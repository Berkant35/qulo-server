-- 090 rollback · local_schedule kolonlarini kaldirir.
-- ONCE sunucu kodunu geri al (motor users sorgusunda local_schedule secer; kolon yokken motor durur).
-- app_config bayragi kolon yokken KAPALI okunur (app-config.service) — o kisim guvenli.
BEGIN;
ALTER TABLE public.app_config DROP COLUMN IF EXISTS local_schedule_enabled;
ALTER TABLE public.users DROP COLUMN IF EXISTS local_schedule;
COMMIT;
