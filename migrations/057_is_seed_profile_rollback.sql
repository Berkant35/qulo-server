-- 057_is_seed_profile_rollback.sql
-- DIKKAT: kolonu dusurmek notification-engine/context.ts'in select'ini kirar.
-- Once o referanslar kaldirilmali; bu yuzden yalniz index geri alinir, kolon kalir.

BEGIN;

DROP INDEX IF EXISTS idx_users_is_seed_profile;

COMMIT;
