-- 078 · app_config.power_demo_enabled — onboarding "güç demosu" uzaktan kapatma anahtarı.
--
-- Neden: mobil carousel 3. sayfasındaki etkileşimli güç demosu (spec 2026-10-17-guc-demosu §7.1)
-- yeni bir akış; kayıp artarsa mağaza sürümü beklemeden backoffice'ten kapatılabilmeli.
-- Kapalıyken istemci bugünkü statik güç ızgarasını (eski sayfa) gösterir; market ▶ ve
-- quiz_intro bağlantısı da gizlenir. Varsayılan AÇIK (true).
--
-- Kod bu kolonu toleransli okur: migration uygulanmadan deploy edilirse true döner
-- (GET /api/v1/app/config -> powerDemoEnabled). Rollback: 078_app_config_power_demo_enabled_rollback.sql.

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS power_demo_enabled boolean NOT NULL DEFAULT true;
