-- 075 rollback · Karşılıklı eşleşme + tercih rızası
-- Kod mutual_match_enabled yokken kapalı sayar (app-config.service), yani rollback kuralı kapatır.
-- DECLINED kullanıcılar eski kodda tercihsiz (PROFILE_INCOMPLETE) kalmasın diye 'BOTH' + set_at alır.
-- user_consents.match_preference satırları SİLİNMEZ (KVKK ispatı); CHECK genişletilmiş kalır.

ALTER TABLE public.app_config DROP COLUMN IF EXISTS mutual_match_enabled;

UPDATE public.users
   SET gender_pref = 'BOTH',
       gender_pref_set_at = COALESCE(gender_pref_set_at, pref_consent_at)
 WHERE pref_consent_status = 'DECLINED';
UPDATE public.users SET gender_pref = 'BOTH' WHERE gender_pref IS NULL;

ALTER TABLE public.users ALTER COLUMN gender_pref SET DEFAULT 'BOTH';
ALTER TABLE public.users ALTER COLUMN gender_pref SET NOT NULL;

ALTER TABLE public.users
  DROP COLUMN IF EXISTS pref_consent_status,
  DROP COLUMN IF EXISTS pref_consent_at;
