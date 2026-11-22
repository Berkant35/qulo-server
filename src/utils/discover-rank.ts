import { hasEnoughInLanguages } from "./quiz-question-set.js";

/**
 * Discover sira gruplari (kucukten buyuge). Karar K3 (2026-11-17): gercek kullanici yabanci dilde
 * olsa bile seed'den ONCE gelir; elenmez, yalniz arkaya alinir.
 */
export const DiscoverGroup = {
  /** Aktif gercek, izleyicinin dilinde (dil kapisini gecen). */
  ACTIVE_OWN_LANGUAGE: 0,
  /** Aktif gercek, yabanci dilde (dil kapisini gecemeyen; >= 2 sorusu var). */
  ACTIVE_FOREIGN_LANGUAGE: 1,
  /** Seed profil (kendi aktifligine bakilmaz; dil on-filtresi sorguda uygulanir). */
  SEED: 2,
  /** Aktif ama cevapsiz eslesmesi yigilmis gercek (dil fark etmez): uyuyandan once, seed'den sonra. */
  ACTIVE_OVER_UNANSWERED_CAP: 3,
  /** Uyuyan gercek, izleyicinin dilinde. */
  DORMANT_OWN_LANGUAGE: 4,
  /** Uyuyan gercek, yabanci dilde. */
  DORMANT_FOREIGN_LANGUAGE: 5,
} as const;

export type DiscoverGroupValue = (typeof DiscoverGroup)[keyof typeof DiscoverGroup];

/** Aday dil kapisini gecti mi: tek tanim `hasEnoughInLanguages` (quiz kumesiyle ortak). */
export const passesLanguageGate = hasEnoughInLanguages;

export function discoverGroupRank(
  isSeed: boolean,
  isDormant: boolean,
  ownLanguage: boolean,
  isOverUnansweredCap = false,
): DiscoverGroupValue {
  if (isSeed) return DiscoverGroup.SEED;
  if (isDormant) return ownLanguage ? DiscoverGroup.DORMANT_OWN_LANGUAGE : DiscoverGroup.DORMANT_FOREIGN_LANGUAGE;
  if (isOverUnansweredCap) return DiscoverGroup.ACTIVE_OVER_UNANSWERED_CAP;
  return ownLanguage ? DiscoverGroup.ACTIVE_OWN_LANGUAGE : DiscoverGroup.ACTIVE_FOREIGN_LANGUAGE;
}
