import { SUPPORTED_LOCALES } from '../constants/locales.js';
import { resolveLocale } from './locales.js';

/**
 * Discover izleyicisinin dilleri. Kaynak users.preferred_languages (054 sonrasi tek kaynak). Eski
 * satirlar icin user_languages'a, o da bossa uygulama diline duser — hicbir yol "filtresiz"e dusmez
 * (bos liste = kullanici okuyamadigi dilde profiller gorur). Seed on-filtresi (sorgu) ve dil kapisi
 * (bellekte, soru dili) ayni listeyi kullanir.
 */
export function izleyiciDilleri(
  preferredLanguages: string[] | null | undefined,
  userLanguages: readonly string[],
  locale: string | null | undefined,
): string[] {
  const tercih = preferredLanguages ?? [];
  if (tercih.length > 0) return tercih;
  if (userLanguages.length > 0) return [...userLanguages];
  return [resolveLocale(locale ?? null)];
}

/**
 * Seed'leri izleyicinin dillerine indiren PostgREST `.or()` ifadesi (gercek kullanici serbest).
 * Seed'in dili `users.locale` (botun dil paketiyle ayni alan). Degerler URL'e HAM gider (postgrest-js
 * kacislamaz): yalniz desteklenen dil kodlari girer, yoksa `)` / `,` iceren bir deger filtreyi
 * genisletebilirdi. Gecerli kod kalmazsa on-filtre yok (eski davranis) — dil kapisi zaten eler.
 */
export function seedLanguageFilter(langs: readonly string[]): string | null {
  const gecerli = [...new Set(langs)].filter((l) => (SUPPORTED_LOCALES as readonly string[]).includes(l));
  if (gecerli.length === 0) return null;
  return `is_seed_profile.eq.false,locale.in.(${gecerli.join(',')})`;
}
