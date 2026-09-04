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

/** Accept-Language basligindaki ilk dil etiketini (q-agirligi ve bolge soyulmus) destekli locale'e cozer; yoksa en. */
export function localeFromAcceptLanguage(header?: string | null): SupportedLocale {
  const first = (header ?? "").split(",")[0]?.split(";")[0]?.trim().split("-")[0]?.toLowerCase();
  return resolveLocale(first || null);
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
