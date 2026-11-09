-- 081 rollback · users.location_source kolonunu kaldirir.
-- ONCE KODU GERI AL: user.service updateLocation / setCityLocation bu kolona yaziyor; kod geri
-- alinmadan kolon dusurulurse konum guncellemesi PGRST204 ile 500 doner.

ALTER TABLE public.users
  DROP COLUMN IF EXISTS location_source;
