-- 019_test_account_flag.sql
-- TikTok video çekimi / marketing seed kullanıcıları için görünürlük kontrolü.
-- is_test_account = true → discover'da yalnızca is_test_admin = true kullanıcılar görür.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_test_account BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_test_admin BOOLEAN NOT NULL DEFAULT false;

-- Partial index — discover query'sinin %99'u is_test_account=false filtreliyor.
CREATE INDEX IF NOT EXISTS idx_users_not_test_account
  ON users(id)
  WHERE is_test_account = false;

COMMENT ON COLUMN users.is_test_account IS
  'Seed/test kullanıcısı işareti. Discover yalnızca is_test_admin=true kullanıcılara gösterir.';

COMMENT ON COLUMN users.is_test_admin IS
  'Test hesaplarını discover''da görme yetkisi. Manuel atanır.';
