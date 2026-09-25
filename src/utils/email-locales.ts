import { createRequire } from "node:module";
import type { SupportedLocale } from "../constants/locales.js";

const require = createRequire(import.meta.url);

export interface MatchNewTpl {
  subject: string;
  preheader: string;
  headline: string;
  body: string;
  cta: string;
  unsubscribe_label: string;
}

export interface BanNoticeTpl {
  subject: string;
  headline: string;
  body: string;
  reason_label: string;
  reason_sexual_content: string;
  reason_guidelines: string;
  appeal_intro: string;
  appeal_cta: string;
  footer: string;
}

export interface EmailLocaleBundle {
  match_new: MatchNewTpl;
  ban_notice: BanNoticeTpl;
}

/**
 * E-posta sozlukleri (src/locales/emails/*.json). Tek nokta: match-email ve ban e-postasi
 * ayni haritayi kullanir; yeni dil SUPPORTED_LOCALES'e girince burasi derlemede kirilir.
 */
export const emailLocales: Record<SupportedLocale, EmailLocaleBundle> = {
  tr: require("../locales/emails/tr.json"),
  en: require("../locales/emails/en.json"),
  de: require("../locales/emails/de.json"),
  fr: require("../locales/emails/fr.json"),
  es: require("../locales/emails/es.json"),
  ar: require("../locales/emails/ar.json"),
  ru: require("../locales/emails/ru.json"),
  pt: require("../locales/emails/pt.json"),
  it: require("../locales/emails/it.json"),
  ja: require("../locales/emails/ja.json"),
  ko: require("../locales/emails/ko.json"),
  zh: require("../locales/emails/zh.json"),
  nl: require("../locales/emails/nl.json"),
  pl: require("../locales/emails/pl.json"),
  sv: require("../locales/emails/sv.json"),
  hi: require("../locales/emails/hi.json"),
  th: require("../locales/emails/th.json"),
  id: require("../locales/emails/id.json"),
};
