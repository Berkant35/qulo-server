-- 081 · users.location_source — konumun kaynagi (2.0.18 plan madde 9, konumsuz yedek yol).
--
-- Neden: kayitlarin %19'u (yeni kadinlarin %30'u) konum izni vermedigi icin Discover 400
-- PROFILE_INCOMPLETE aliyordu. Yeni uc PATCH /users/me/location/city secilen sehrin MERKEZ
-- koordinatini users.lat/lng'ye yazar. Bu kolon koordinatin GPS mi sehir merkezi mi oldugunu
-- isaretler: mesafe gosterimi/olcum ayrimi icin; GPS ile guncellenince 'gps'e doner.
--   NULL  = eski kayit (bu kolondan once; GPS kabul edilir)
--   'gps' = cihaz konumu (PATCH /users/me/location)
--   'city'= elle secilen sehir merkezi (PATCH /users/me/location/city)
--
-- Rollback: 081_users_location_source_rollback.sql (once kod geri alinir).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS location_source text
    CONSTRAINT users_location_source_check CHECK (location_source IN ('gps', 'city'));
