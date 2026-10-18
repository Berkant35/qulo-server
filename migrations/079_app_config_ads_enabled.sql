-- 079 · app_config.ads_enabled — reklam (AdMob) uzaktan açma anahtarı.
--
-- Neden: reklam gösterimi gerçek AdMob kimlikleri girilene ve bilinçli karar verilene kadar KAPALI
-- kalmalı; açma/kapama mağaza sürümü beklemeden backoffice'ten yapılır. Varsayılan KAPALI (false).
--
-- Kod bu kolonu toleransli okur: migration uygulanmadan deploy edilirse false döner
-- (GET /api/v1/app/config -> adsEnabled, fail-closed). Rollback: 079_app_config_ads_enabled_rollback.sql.

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS ads_enabled boolean NOT NULL DEFAULT false;
