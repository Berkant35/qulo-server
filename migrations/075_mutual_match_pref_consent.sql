-- 075 · Karşılıklı eşleşme + eşleşme tercihi açık rızası
-- Spec: docs/superpowers/specs/2026-10-05-karsilikli-eslesme-ve-tercih-rizasi-design.md
--
-- 1) gender_pref_set_at canlıda vardı, repoda migration'ı yoktu (drift kaydı).
-- 2) gender_pref NULL = tercih saklanmıyor (rıza yok / reddedildi) → eşleşmede "Herkes".
--    set_at boş satırlardaki 'BOTH' bir seçim değil, legacy/001 varsayılanıydı.
--    Seed'ler set_at'siz ama tercihleri bilinçli — UPDATE dışında.
-- 3) Rıza durumu (hızlı sorgu); ispat user_consents'te (consent_type = match_preference).
-- 4) mutual_match_enabled: karşılıklı kuralın kill-switch'i (varsayılan kapalı).
--
-- Kolon yetkisi: 051 users'ta SELECT'i anon/authenticated'dan aldı, yalnız
-- (id, is_online, last_seen_at) kolonlarını verdi — yeni kolonlar otomatik kapalı.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS gender_pref_set_at timestamptz;

ALTER TABLE public.users ALTER COLUMN gender_pref DROP DEFAULT;
ALTER TABLE public.users ALTER COLUMN gender_pref DROP NOT NULL;
UPDATE public.users
   SET gender_pref = NULL
 WHERE gender_pref_set_at IS NULL
   AND is_seed_profile = false;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pref_consent_status text
    CONSTRAINT users_pref_consent_status_check CHECK (pref_consent_status IN ('GRANTED', 'DECLINED')),
  ADD COLUMN IF NOT EXISTS pref_consent_at timestamptz;

ALTER TABLE public.user_consents DROP CONSTRAINT IF EXISTS user_consents_consent_type_check;
ALTER TABLE public.user_consents ADD CONSTRAINT user_consents_consent_type_check
  CHECK (consent_type IN ('terms_of_service', 'privacy_policy', 'kvkk_explicit', 'match_preference'));

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS mutual_match_enabled boolean NOT NULL DEFAULT false;
