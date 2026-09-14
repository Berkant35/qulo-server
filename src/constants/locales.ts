export const SUPPORTED_LOCALES = [
  'tr', 'en', 'de', 'fr', 'es', 'ar', 'ru',
  'pt', 'it', 'ja', 'ko', 'zh', 'nl', 'pl', 'sv', 'hi',
  'th', 'id',
] as const;

export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

// Display names for each locale (used in API responses)
export const LOCALE_NAMES: Record<SupportedLocale, string> = {
  tr: 'Türkçe',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  ar: 'العربية',
  ru: 'Русский',
  pt: 'Português',
  it: 'Italiano',
  ja: '日本語',
  ko: '한국어',
  zh: '中文',
  nl: 'Nederlands',
  pl: 'Polski',
  sv: 'Svenska',
  hi: 'हिन्दी',
  th: 'ไทย',
  id: 'Bahasa Indonesia',
};

/**
 * Bir sorunun dili. `locale` alani bos ya da NULL gelen eski satirlar 'tr' sayilir.
 *
 * NEDEN TEK YERDE: bu normalizasyon alti ayri yerde kopyalanmisti — kesif aday
 * filtresi (matching 5.6), kesif kart bilgisi, public profil, quiz soru secimi
 * ve getMe. Hepsi ayni davranisa BAGLI: biri `?? 'en'` yapsa hicbir test
 * kirilmaz, ama istemci "gorunuyorsun" derken kesif tersini uygular, ya da
 * kullaniciya cozemeyecegi bir soru gosterilir. Invaryant temenni degil,
 * tek fonksiyon olmali.
 */
export function questionLocale(locale: unknown): string {
  return typeof locale === "string" && locale ? locale : "tr";
}

/**
 * quloapp.com'un arayuz/yasal sayfa dilleri (web/src/lib/i18n/config.ts `locales`).
 * Web ve sunucu ayri deploy edilir; web bir dili geride birakirsa sunucunun urettigi
 * linkler `webLocale()` ile `en`'e kirpilir. Parite testi web repo'sunu okur.
 */
export const WEB_LOCALES = [
  'tr', 'en', 'de', 'fr', 'es', 'ar', 'ru',
  'pt', 'it', 'ja', 'ko', 'zh', 'nl', 'pl', 'sv', 'hi',
  'th', 'id',
] as const;
export type WebLocale = typeof WEB_LOCALES[number];
