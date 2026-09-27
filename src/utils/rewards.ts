/**
 * Rainbow market'in saf kuralları (spec 2026-09-27 §2.6, §6). DB'ye dokunmaz; market servisi,
 * backoffice servisi ve controller aynı kuralı buradan okur.
 */

/** Aylık tavana sayılan talep durumları. Reddedilen talep iade edildiği için sayılmaz. */
export const CAP_STATUSES = ["PENDING", "FULFILLED"] as const;

/** Defter reason'ları — itfa (market) ve iade (market telafisi + backoffice reddi) buradan okur. */
export const REWARD_REDEEM_REASON = "REWARD_REDEEM";
export const REWARD_REFUND_REASON = "REWARD_REFUND";

/** İtfa ve iade satırlarının ortak defter referansı: talebe bağlı iz (elle kurtarma bununla aranır). */
export function redemptionReference(redemptionId: string): string {
  return `redemption:${redemptionId}`;
}

const DAY_MS = 86_400_000;

/** Tavan "bu takvim ayı": UTC ayının ilk anı (sunucu saat diliminden bağımsız). */
export function monthStartUtc(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Hesap yaşı gün olarak (kesirli). */
export function accountAgeDays(createdAt: string, now: Date): number {
  return (now.getTime() - Date.parse(createdAt)) / DAY_MS;
}

/**
 * Backoffice'in önerdiği rainbow fiyatı: tedarikçi maliyeti ÷ rainbow başına hedef USD, yukarı
 * yuvarlanır. Bölüm önce 6 haneye yuvarlanır: 0,9 / 0,03 kayan noktada 30,000000000000004 çıkar ve
 * `ceil` fiyatı bir birim şişirirdi. Maliyet yoksa öneri yok (null). En az 1.
 */
export function suggestedRainbowPrice(
  costUsd: number | null | undefined,
  usdPerRainbow: number,
): number | null {
  if (costUsd == null || !(costUsd > 0) || !(usdPerRainbow > 0)) return null;
  const ratio = Math.round((costUsd / usdPerRainbow) * 1e6) / 1e6;
  return Math.max(1, Math.ceil(ratio));
}

/**
 * Kuyruk listesinde teslim kodu maskeli (kod nakit değerinde). Yalnız 10+ karakterli kodda son 4
 * karakter görünür; kısa kodda hiçbiri — son 4, kısa kodun çoğunu açık ederdi.
 */
export function maskDeliveryCode(code: string | null | undefined): string {
  if (!code) return "";
  return code.length >= 10 ? `••••${code.slice(-4)}` : "••••";
}

/**
 * Teslim linki de kod gibi nakit değerinde (bir defaya mahsus taşıyıcı kimlik bilgisi): backoffice
 * kuyruğuna tam link değil yalnız host gider — path/query genelde talep/talep sahibini tanımlayan
 * token taşır. Geçersiz ya da boş URL → null (joker sayfada göstermez).
 */
export function deliveryHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
