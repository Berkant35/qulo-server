/**
 * Discover kartindaki aktiflik rozeti (2.0.18 plan madde 8): kullanici quiz'e emek harcamadan once
 * karsi tarafin cevap verme ihtimalini gorsun. Ham zaman damgasi (last_seen_at) ISTEMCIYE GITMEZ —
 * yalniz kaba kova: gizlilik (ne zaman cevrimici oldugu dakika dakika izlenemesin).
 *
 *   "today" = son 24 saatte goruldu (takvim gunu degil: saat dilimi bagimsiz)
 * Kova saat basina yuvarlanmis zamandan hesaplanir: Discover'i tekrar tekrar ceken biri rozetin
 * degistigi andan karsi tarafin donus/ayrilis anini dakika hassasiyetinde cikaramasin (2.0.18 inceleme).
 *   "week"  = son 7 gunde goruldu
 *   null    = daha eski / hic gorulmedi / bilinmiyor
 */
export type ActivitySignal = "today" | "week";

export const ACTIVITY_TODAY_MS = 24 * 60 * 60 * 1000;
export const ACTIVITY_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export function activitySignal(lastSeenAt: string | null | undefined, nowMs: number): ActivitySignal | null {
  if (!lastSeenAt) return null;
  const seenMs = Date.parse(lastSeenAt);
  if (!Number.isFinite(seenMs)) return null;
  const age = nowMs - Math.floor(seenMs / HOUR_MS) * HOUR_MS;
  if (age < ACTIVITY_TODAY_MS) return "today";
  if (age < ACTIVITY_WEEK_MS) return "week";
  return null;
}
