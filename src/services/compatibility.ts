/**
 * Karşılıklı eşleşme kuralı — tek kaynak (spec 2026-10-05 §4).
 *
 * İki kişi ancak birbirinin istediği kovadaysa birbirini görür. Discover bu kuralı
 * PostgREST filtresine (`candidatePrefFilter` + `wantsOf`), swipe/quiz guard'ı doğrudan
 * `isMutuallyCompatible`'a çevirir. Kimlik modelinde (alt iş 2: İkili olmayan kova,
 * çoklu tercih) yalnız `bucketOf` / `wantsOf` eşlemesi değişir; çağıranlar değişmez.
 */

export type Bucket = "MAN" | "WOMAN" | "OTHER";

export const ALL_BUCKETS: readonly Bucket[] = ["MAN", "WOMAN", "OTHER"];

/** `gender_pref_type` enum değerleri — filtrede yalnız bunlar üretilir (OTHER yok). */
const PREF_VALUES = ["MAN", "WOMAN", "BOTH"] as const;

export interface CompatibilityProfile {
  gender?: string | null;
  gender_pref?: string | null;
}

export function bucketOf(u: CompatibilityProfile): Bucket | null {
  return (ALL_BUCKETS as readonly string[]).includes(u.gender ?? "") ? (u.gender as Bucket) : null;
}

/** BOTH ve NULL (rıza yok / reddedildi) üç kovayı da ister. */
export function wantsOf(u: CompatibilityProfile): ReadonlySet<Bucket> {
  switch (u.gender_pref) {
    case "MAN":
      return new Set<Bucket>(["MAN"]);
    case "WOMAN":
      return new Set<Bucket>(["WOMAN"]);
    default:
      return new Set<Bucket>(ALL_BUCKETS);
  }
}

export function isMutuallyCompatible(a: CompatibilityProfile, b: CompatibilityProfile): boolean {
  const bucketA = bucketOf(a);
  const bucketB = bucketOf(b);
  if (!bucketA || !bucketB) return false;
  return wantsOf(a).has(bucketB) && wantsOf(b).has(bucketA);
}

/**
 * "Adayın tercihi izleyicinin kovasını kapsar" koşulu, PostgREST `.or()` ifadesi olarak.
 * Değerler enum'dan türetilir: izleyici OTHER ise `eq.OTHER` üretilmez (enum'da yok).
 */
export function candidatePrefFilter(viewerBucket: Bucket): string {
  const accepting = PREF_VALUES.filter((pref) => wantsOf({ gender_pref: pref }).has(viewerBucket));
  return ["gender_pref.is.null", ...accepting.map((pref) => `gender_pref.eq.${pref}`)].join(",");
}
