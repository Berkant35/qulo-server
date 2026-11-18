-- 087_economy_2_2_0_rollback.sql
-- 087'nin actigi surumu pasif yapar, ONCEKI surumu yeniden aktif eder (087 satiri tarihce icin kalir, silinmez).
-- Aktif surum 087'ninki degilse (araya admin'den yeni surum girilmis) DURUR: elle kaydedilmis config'i ezmez.
-- Etki: ucretsiz kesif limiti 50'ye, profil/rozet odulleri eski degerlere doner (en gec 5 dk onbellek).

BEGIN;

DO $$
DECLARE
  cur  economy_config_versions%ROWTYPE;
  prev economy_config_versions%ROWTYPE;
BEGIN
  SELECT * INTO cur FROM economy_config_versions WHERE is_active = true FOR UPDATE;
  IF NOT FOUND OR cur.change_reason NOT LIKE '087_economy_2_2_0%' THEN
    RAISE EXCEPTION '087 rollback: aktif surum 087''nin degil; admin''den geri alin';
  END IF;

  SELECT * INTO prev FROM economy_config_versions WHERE version < cur.version ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION '087 rollback: onceki surum bulunamadi';
  END IF;

  UPDATE economy_config_versions SET is_active = false WHERE id = cur.id;
  UPDATE economy_config_versions SET is_active = true  WHERE id = prev.id;
END $$;

COMMIT;
