-- 069_reward_redemptions_keep_on_purge_rollback.sql
-- 069'u geri alır. Önce kodu geri al (sahipsiz talebi ele alan kod NULL user_id bekler).
-- NOT NULL yalnız sahipsiz talep YOKSA geri gelir: varsa finansal kayıt silinmez, NOTICE verilir.

BEGIN;

DROP INDEX IF EXISTS idx_diamond_rainbow_reference;

ALTER TABLE reward_redemptions DROP CONSTRAINT IF EXISTS reward_redemptions_user_id_fkey;
ALTER TABLE reward_redemptions
  ADD CONSTRAINT reward_redemptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM reward_redemptions WHERE user_id IS NULL) THEN
    RAISE NOTICE 'reward_redemptions: sahipsiz talep var, user_id NOT NULL geri getirilmedi';
  ELSE
    ALTER TABLE reward_redemptions ALTER COLUMN user_id SET NOT NULL;
  END IF;
END $$;

COMMIT;
