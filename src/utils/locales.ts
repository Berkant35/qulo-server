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
