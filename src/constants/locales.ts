export const SUPPORTED_LOCALES = [
  'tr', 'en', 'de', 'fr', 'es', 'ar', 'ru',
  'pt', 'it', 'ja', 'ko', 'zh', 'nl', 'pl', 'sv',
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
};
