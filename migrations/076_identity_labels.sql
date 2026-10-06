-- 076 · Kimlik & yönelim etiketleri (alt iş 2)
-- Spec: docs/superpowers/specs/2026-10-06-kimlik-yonelim-etiketleri-design.md
--
-- Etiketler isteğe bağlı profil bilgisidir; eşleşmeye etkisi yoktur. KVKK m.6 özel nitelikli
-- veri: users'tan ayrı, PostgREST'e (anon/authenticated) tamamen kapalı tablo; yalnız sunucu
-- (service_role) okur/yazar. Katalog değerleri sunucu zod şemasında doğrulanır (DB'de CHECK yok —
-- katalog büyüyebilir). Rıza ispatı user_consents'te (consent_type = identity_labels).

CREATE TABLE IF NOT EXISTS public.user_identity (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  gender_labels text[] NOT NULL DEFAULT '{}'
    CONSTRAINT user_identity_gender_labels_max CHECK (cardinality(gender_labels) <= 3),
  orientation_labels text[] NOT NULL DEFAULT '{}'
    CONSTRAINT user_identity_orientation_labels_max CHECK (cardinality(orientation_labels) <= 3),
  show_gender_labels boolean NOT NULL DEFAULT false,
  show_orientation_labels boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.user_identity FROM anon, authenticated;
ALTER TABLE public.user_identity ENABLE ROW LEVEL SECURITY;  -- policy yok ⇒ anon/auth erişimi kapalı

ALTER TABLE public.user_consents DROP CONSTRAINT IF EXISTS user_consents_consent_type_check;
ALTER TABLE public.user_consents ADD CONSTRAINT user_consents_consent_type_check
  CHECK (consent_type IN ('terms_of_service', 'privacy_policy', 'kvkk_explicit', 'match_preference', 'identity_labels'));
