import { fnv1a32 } from '../../utils/hash.js';
import { DECISION_WINDOW_MS } from './context.js';
import { WEEK_MS } from './timezone.js';

/**
 * "Bogmama" politikasi — TEK yer. Lifecycle motoru da tekrarlayan kampanya gondericisi de
 * ayni fonksiyonla karar verir: ayni holdout kovasi, ayni gunluk/haftalik tavan.
 * sendTimes: kullanici basina gercek gonderim zamanlari (push_log 'sent' + kampanya inbox satirlari).
 */
export type ThrottleReason = 'daily_cap' | 'weekly_cap' | 'holdout';

export interface ThrottleConfig {
  daily_cap: number;
  weekly_cap: number;
  holdout_pct: number;
}

/** Deterministik holdout kovasi (0-99): ayni kullanici her turda ve her gondericide ayni grupta kalir. */
export function holdoutBucket(userId: string): number {
  return fnv1a32(userId) % 100;
}

function countSince(times: number[] | undefined, sinceMs: number): number {
  return (times ?? []).filter((t) => t >= sinceMs).length;
}

export function throttleReason(
  userId: string,
  sendTimes: Map<string, number[]>,
  config: ThrottleConfig,
  nowMs: number,
): ThrottleReason | null {
  const times = sendTimes.get(userId);
  if (countSince(times, nowMs - DECISION_WINDOW_MS) >= config.daily_cap) return 'daily_cap';
  if (countSince(times, nowMs - WEEK_MS) >= config.weekly_cap) return 'weekly_cap';
  if (holdoutBucket(userId) < config.holdout_pct) return 'holdout';
  return null;
}
