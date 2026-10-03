-- 074 rollback · discover_dormant_days kolonunu kaldirir.
-- Kod kolon yokken varsayilan 14 gune duser (app-config.service getDiscoverDormantDays),
-- admin formu alani gostermez; rollback sonrasi discover sirasi 14 gunle calismaya devam eder.

ALTER TABLE public.app_config
  DROP COLUMN IF EXISTS discover_dormant_days;
