-- 079 rollback · ads_enabled kolonunu kaldırır.
-- Kod kolon yokken reklamı KAPALI sayar (app-config.service getAdsEnabled) — rollback güvenlidir.

ALTER TABLE public.app_config
  DROP COLUMN IF EXISTS ads_enabled;
