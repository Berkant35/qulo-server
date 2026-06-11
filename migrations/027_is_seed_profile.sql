-- 027_is_seed_profile.sql
-- Mark fake/seed profiles for clean removal later.
-- Discover/match flows do NOT filter on this column — seed profiles
-- behave exactly like real users until cleanup.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_seed_profile BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_users_is_seed_profile
  ON users(is_seed_profile)
  WHERE is_seed_profile = true;
