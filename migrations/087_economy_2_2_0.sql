-- 087_economy_2_2_0.sql
-- Qulo 2.2.0 ekonomi (kalem B1 + B2, kararlar K2 + K4, plan tasks/surum-2.2.0-plan.md):
--   * Ucretsiz plan gunluk kesif limiti        50  -> 25
--   * Profil tamamlama odulleri (%25/50/75/100) 5/15/30/50 -> 2/3/5/10   (toplam 100 -> 20)
--   * Rozet odulleri (SILVER/GOLD)              3/10 -> 1/3  (config'e tasindi: rewards.badges)
-- DEGISMEYEN: rewards.starterPurple / starterPowers, referralPurple, plus/premium limitleri.
--
-- !! UYGULAMA ZAMANI (K4): bu migration aktif config'i DEGISTIRIR; canlidaki TUM surumler (2.0.x dahil)
-- anlik etkilenir (limit sunucu tarafinda uygulanir). Yalnizca 2.2.0 yayinlanirken (mobil + haftalik paket +
-- odullu reklam hazirken) uygulanir. Sunucu kodu (release/2.2.0) ile ayni yayin penceresinde.
--
-- Yontem: mevcut surumleme mekanizmasi (020) — create_economy_config_version RPC'si eski aktif satiri
-- is_active=false yapar, yeni surumu ekler. Eski surum SILINMEZ/EZILMEZ. Mevcut aktif config'in
-- BASKA tum alanlari (guc fiyatlari, rainbow, quizOnboarding...) aynen korunur; yalniz 3 yol degisir.
-- Sunucu config onbellegi 5 dk TTL: degisiklik en gec 5 dakikada tum instance'lara yansir.
-- Rollback: 087_economy_2_2_0_rollback.sql (onceki surumu yeniden aktif eder).

BEGIN;

DO $$
DECLARE
  cur          economy_config_versions%ROWTYPE;
  next_version INT;
  new_config   JSONB;
  new_ms       CONSTANT JSONB := '{"25": 2, "50": 3, "75": 5, "100": 10}'::jsonb;
  new_badges   CONSTANT JSONB := '{"SILVER": 1, "GOLD": 3}'::jsonb;
BEGIN
  SELECT * INTO cur FROM economy_config_versions WHERE is_active = true FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '087: aktif economy config bulunamadi';
  END IF;

  -- Yeniden calistirmaya dayanikli: zaten bu degerlerdeyse yeni surum acma.
  IF (cur.config #>> '{subscriptionLimits,free,dailyDiscovers}')::int = 25
     AND cur.config #> '{rewards,milestones}' = new_ms
     AND cur.config #> '{rewards,badges}' = new_badges THEN
    RAISE NOTICE '087: aktif config zaten 2.2.0 degerlerinde (v%), atlandi', cur.version;
    RETURN;
  END IF;

  new_config := jsonb_set(cur.config, '{subscriptionLimits,free,dailyDiscovers}', '25'::jsonb);
  new_config := jsonb_set(new_config, '{rewards,milestones}', new_ms);
  new_config := jsonb_set(new_config, '{rewards,badges}', new_badges);

  SELECT COALESCE(MAX(version), 0) + 1 INTO next_version FROM economy_config_versions;

  PERFORM create_economy_config_version(
    next_version,
    new_config,
    NULL,
    '087_economy_2_2_0: ucretsiz kesif 50->25, profil odulu 5/15/30/50->2/3/5/10, rozet 3/10->1/3 (onceki surum v' || cur.version || ')'
  );
END $$;

COMMIT;
