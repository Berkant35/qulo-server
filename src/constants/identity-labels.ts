/**
 * Kimlik & yönelim etiket kataloğu (spec 2026-10-06 §1) — kanonik liste, sıra dahil.
 * Etiketler yalnız profil bilgisidir, eşleşmeye etkisi yoktur; kova `users.gender` (MAN/WOMAN).
 * Yeni etiket: buraya anahtar + mobil `IdentityLabels` + 18 dil çevirisi.
 */
export const GENDER_LABELS = [
  "cis_woman", "cis_man", "trans_woman", "trans_man", "non_binary", "genderqueer", "genderfluid",
  "agender", "bigender", "intersex", "transfeminine", "transmasculine", "questioning",
] as const;

export const ORIENTATION_LABELS = [
  "straight", "gay", "lesbian", "bisexual", "pansexual", "asexual", "demisexual", "queer",
  "questioning", "heteroflexible", "homoflexible",
] as const;

export const MAX_LABELS_PER_GROUP = 3;

/** Etiket açık rızası metin sürümü (mobil `IdentityConsent.version`). */
export const IDENTITY_CONSENT_VERSION = "2026-10-v1";

/** Kabul edilen rıza sürümleri (ispat defterine keyfi metin yazılmasın). Yeni metin sürümü: buraya ekle. */
export const IDENTITY_CONSENT_VERSIONS = [IDENTITY_CONSENT_VERSION] as const;
