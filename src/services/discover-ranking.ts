/**
 * Discover siralama/eleme kurallari — saf fonksiyonlar (DB yok). matching.service.discover bunlari
 * sirayla uygular; kurallar burada tek yerde ve dogrudan test edilebilir.
 */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Bos destenin sebebi — mobil `DiscoverEmptyReason`; bilinmeyen deger mobilde no_candidates metnine duser. */
export type DiscoverEmptyReason = "language" | "inactive" | "no_candidates";

/**
 * Discover sira grubu: 0 = aktif gercek, 1 = seed, 2 = aktif ama cevapsiz eslesmesi yigilmis gercek,
 * 3 = uyuyan gercek. Seed'in kendi aktifligi/eslesmeleri bakilmaz (presence ritmi yapay); seed hep grup 1.
 * Yigilmis aktif aday uyuyandan ONDE: uygulamada, cevap verme ihtimali hic girmeyenden yuksek.
 */
export function discoverGroupRank(isSeed: boolean, isDormant: boolean, isOverUnansweredCap = false): number {
  if (isSeed) return 1;
  if (isDormant) return 3;
  return isOverUnansweredCap ? 2 : 0;
}

/**
 * Uzun suredir gorulmeyen gercek adaylari desteden cikarir (`app_config.discover_inactive_exclude_days`,
 * 0 = kapali). Seed haric (presence ritmi yapay); `last_seen_at` bos olan da cikar (hic gorulmemis).
 * 2026-11-09: hedeflerin %79'u eslesme aninda >=3 gundur gorulmemisti, 208 eslesmenin 4'u konusmaya dondu.
 */
export function excludeLongInactive<T extends { is_seed_profile: boolean | null; last_seen_at: string | null }>(
  candidates: T[],
  excludeDays: number,
  nowMs: number,
): T[] {
  if (excludeDays <= 0) return candidates;
  const cutoff = nowMs - excludeDays * DAY_MS;
  return candidates.filter(
    (c) => c.is_seed_profile === true || (c.last_seen_at != null && Date.parse(c.last_seen_at) >= cutoff),
  );
}

/**
 * Bos destenin sebebi, eleme zincirinin sirasiyla (dil → aktiflik):
 * dil oncesi aday vardi ama dil kapisi hepsini eledi → "language"; dil kapisini gecenler vardi ama
 * hepsi uzun suredir gorulmuyordu → "inactive"; hic aday yoktu → "no_candidates".
 */
export function emptyReasonOf(beforeLanguageCount: number, beforeInactiveCount: number): DiscoverEmptyReason {
  if (beforeLanguageCount > 0 && beforeInactiveCount === 0) return "language";
  if (beforeInactiveCount > 0) return "inactive";
  return "no_candidates";
}
