-- 064 rollback: moderasyon kayitlari, itiraz tokenlari ve kill-switch kaldirilir.
BEGIN;
DROP TABLE IF EXISTS ban_appeals;
DROP TABLE IF EXISTS photo_moderation_checks;
ALTER TABLE app_config DROP COLUMN IF EXISTS photo_moderation_enabled;
COMMIT;
