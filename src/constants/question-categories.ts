/**
 * Soru kategorileri — tek kaynak. Validator (istek dogrulama), admin soru bankasi ekrani
 * ve seed script'leri buradan okur; elle kopya YASAK (locales ile ayni ilke).
 */
export const QUESTION_CATEGORIES = [
  'personality', 'music', 'film', 'sports', 'travel',
  'food', 'technology', 'general', 'other',
  'fun', 'entertainment', 'lifestyle', 'humor',
  'hobby', 'science', 'history', 'art', 'nature',
] as const;
export type QuestionCategory = typeof QUESTION_CATEGORIES[number];
