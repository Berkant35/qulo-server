import type { IncomingHttpHeaders } from "node:http";
import { SUPPORTED_LOCALES } from '../constants/locales.js';
import type { SupportedLocale } from '../constants/locales.js';

/**
 * Normalize an input locale to a supported one.
 * Unknown/null/undefined falls back to 'en'.
 * Case-sensitive: 'TR' → 'en' (callers must lowercase first if needed).
 */
export function resolveLocale(input?: string | null): SupportedLocale {
  if (input && (SUPPORTED_LOCALES as readonly string[]).includes(input)) {
    return input as SupportedLocale;
  }
  return 'en';
}

export { SUPPORTED_LOCALES };
export type { SupportedLocale };

/**
 * Store'daki eski mobil surumler Accept-Language header'i gondermez; onlarda
 * dal oncesi varsayilan (tr) korunur. Yeni surum header gonderiyor. Yeni surum
 * yeterince yayginlasinca bu sabit ve localeFromRequestHeaders'daki legacy dali
 * kaldirilabilir.
 */
export const LEGACY_CLIENT_LOCALE: SupportedLocale = 'tr';

/**
 * Accept-Language basligindaki etiketleri sirayla dener: q-agirligi 0 olani atlar,
 * alt etiketi ("-" veya "_") ayirip dil kodunu kucuk harfe cevirir; ilk destekli
 * olani doner, hicbiri desteklenmiyorsa en.
 */
export function localeFromTag(input?: string | null): SupportedLocale {
  const entries = (input ?? "").split(",");
  for (const raw of entries) {
    const entry = raw.trim();
    if (!entry) continue;

    const [tagPart, ...paramParts] = entry.split(";");
    const tag = tagPart.trim();
    if (!tag) continue;

    const qParam = paramParts
      .map((p) => p.trim().toLowerCase())
      .find((p) => p.startsWith("q="));
    if (qParam && parseFloat(qParam.slice(2)) === 0) continue;

    const lang = tag.split(/[-_]/)[0]?.toLowerCase();
    if (lang && (SUPPORTED_LOCALES as readonly string[]).includes(lang)) {
      return lang as SupportedLocale;
    }
  }
  return 'en';
}

/**
 * Accept-Language header'ini istekten cozer. Baslik hic yoksa (eski mobil
 * istemci, bkz. LEGACY_CLIENT_LOCALE) dal oncesi varsayilan korunur; baslik
 * varsa (bos string dahil) localeFromTag ile parse edilir.
 */
export function localeFromRequestHeaders(headers: IncomingHttpHeaders): SupportedLocale {
  if (headers["accept-language"] === undefined) return LEGACY_CLIENT_LOCALE;
  return localeFromTag(headers["accept-language"]);
}

/**
 * 16-dil JSONB label'dan kullanıcının diline en uygun değeri seçer.
 * Fallback: istenen locale → en → ilk dolu değer → "".
 */
export function pickLabel(
  label: Record<string, string> | null | undefined,
  locale?: string,
): string {
  if (!label) return "";
  const loc = resolveLocale(locale);
  if (label[loc]?.trim()) return label[loc];
  if (label.en?.trim()) return label.en;
  const first = Object.values(label).find((v) => v?.trim());
  return first ?? "";
}
