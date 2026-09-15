-- 058_users_photo_prompt_rollback.sql
-- Kolon yalnız seed script'leri tarafından yazılır/okunur (tr-seed-lib.ts); düşürmek uygulama kodunu kırmaz.
-- Seed profilleri silinmişse (delete-tr-test-profiles.ts --confirm) veri kaybı yoktur; duruyorsa klonlar gider ama
-- seed-profiles/tr-selection.json + photos-manifest.json'dan yeniden üretilebilir (seed_run.py, foto cache'ten ücretsiz).

BEGIN;

ALTER TABLE users DROP COLUMN IF EXISTS photo_prompt;

COMMIT;
