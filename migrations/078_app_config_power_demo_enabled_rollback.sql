-- 078 rollback · power_demo_enabled kolonunu kaldırır.
-- Kod kolon yokken demoyu AÇIK sayar (app-config.service getPowerDemoEnabled) — yani rollback
-- demoyu KAPATMAZ. Demoyu kapatmak istiyorsan kolonu düşürmek yerine backoffice'ten anahtarı
-- kapat (ya da `UPDATE public.app_config SET power_demo_enabled = false`).

ALTER TABLE public.app_config
  DROP COLUMN IF EXISTS power_demo_enabled;
