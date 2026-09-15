-- 057_is_seed_profile.sql
-- users.is_seed_profile kolonu canli DB'de zaten var (notification-engine/context.ts okuyor)
-- ama repoda migration dosyasi yoktu (plan 2026-06-11'deki 027 hic commit'lenmemis).
-- Bu dosya canli durumu belgeler; IF NOT EXISTS oldugu icin prod'da no-op.
--
-- Anlam: tools/seed_photos.py + scripts/seed/seed-tr-test-profiles.ts ile basilan
-- TR seed profilleri. Bu profiller ayrica is_test_account=true tasir (discover'da
-- yalniz is_test_admin gorur — matching.service.ts). Kolon toplu silme icindir:
-- scripts/seed/delete-tr-test-profiles.ts --confirm

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_seed_profile BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_users_is_seed_profile
  ON users (is_seed_profile)
  WHERE is_seed_profile = true;

COMMIT;
