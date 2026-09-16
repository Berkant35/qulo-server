-- 059_seed_ai_sohbet_rollback.sql
-- Geri alma guvenli: seed_reply_queue yalniz bot kuyrugudur, kullanici verisi tasimaz.
-- users.seed_persona yalniz seed profillerde doludur ve scripts/seed/derive-seed-persona.ts ile
-- yeniden uretilebilir. app_config bayraklari varsayilan false oldugundan dusurulmesi davranis degistirmez.

BEGIN;

DROP FUNCTION IF EXISTS claim_seed_replies(int);
DROP TABLE IF EXISTS seed_reply_queue;

ALTER TABLE app_config DROP COLUMN IF EXISTS seed_reply_enabled;
ALTER TABLE app_config DROP COLUMN IF EXISTS seed_reply_fast_mode;
ALTER TABLE users DROP COLUMN IF EXISTS seed_persona;

COMMIT;
