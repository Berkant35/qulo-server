import { createRequire } from 'node:module';
import type { SupportedLocale } from '../constants/locales.js';

const require = createRequire(import.meta.url);

/**
 * Sunucu metinleri (`src/locales/*.json`): dil → bolum → anahtar.
 * Build `src/locales`'i `dist/locales`'e kopyalar; yol her iki agacta da gecerli.
 * Bildirim sablonlari (`push`) ve eslesme listesi onizlemesi (`chat_preview`) ayni kaynaktan okur.
 */
export const serverLocales: Record<SupportedLocale, Record<string, Record<string, unknown>>> = {
  tr: require('../locales/tr.json'),
  en: require('../locales/en.json'),
  de: require('../locales/de.json'),
  fr: require('../locales/fr.json'),
  es: require('../locales/es.json'),
  ar: require('../locales/ar.json'),
  ru: require('../locales/ru.json'),
  pt: require('../locales/pt.json'),
  it: require('../locales/it.json'),
  ja: require('../locales/ja.json'),
  ko: require('../locales/ko.json'),
  zh: require('../locales/zh.json'),
  nl: require('../locales/nl.json'),
  pl: require('../locales/pl.json'),
  sv: require('../locales/sv.json'),
  hi: require('../locales/hi.json'),
};

/** Bolum/anahtar metni; dilde yoksa en, o da yoksa bos string. */
export function localeText(locale: SupportedLocale, section: string, key: string): string {
  const pick = (loc: SupportedLocale): string | undefined => {
    const value = serverLocales[loc]?.[section]?.[key];
    return typeof value === 'string' && value.trim() ? value : undefined;
  };
  return pick(locale) ?? pick('en') ?? '';
}
