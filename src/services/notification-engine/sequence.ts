import type { PushLogEntry, EngineUser } from './context.js';
import type { LifecycleRule } from './rules.js';
import { lastActiveMs } from './rules.js';
import { DAY_MS } from './timezone.js';

/**
 * Kural dizisi — "birkac dokunus, artan aralikla, sonra sessizlik" (throttle.ts gibi saf politika).
 *
 * step = bu kural icin simdiye kadarki gonderim sayisi; ilk gonderim kural uyar uymaz (step 0),
 * sonraki gonderim bir oncekinden schedule[step-1] gun sonra; step > schedule.length → susar.
 * step, EN YENI 'sent' kaydinin payload.sequence_step'inden okunur (satir sayisindan degil): push_log
 * 90 gun sonra budandiginda eski satirlar dusse de sayac gerilemez; yalniz son kayit da dusunce
 * dizi TEK SEFERLIK bastan baslar (kabul edilen sinir). Eski kayitlarda sequence_step yoksa sayim.
 * resetOnActivity: yalniz son aktiflikten SONRAKI gonderimler sayilir (kullanici dondu → bastan).
 */
export type SequenceState = 'ready' | 'waiting' | 'silenced';

export interface SequenceProgress {
  state: SequenceState;
  /** Simdiye kadarki gonderim sayisi; bir sonraki gonderim step+1 numarasini alir. */
  step: number;
}

export function sequenceProgress(
  user: EngineUser,
  entries: PushLogEntry[],
  rule: LifecycleRule,
  scheduleDays: number[],
  nowMs: number,
): SequenceProgress {
  const floor = rule.resetOnActivity ? lastActiveMs(user) : 0;
  const sends = entries.filter((e) => e.decision === 'sent' && e.ruleKey === rule.key && e.createdAt > floor);
  if (sends.length === 0) return { state: 'ready', step: 0 };
  const newest = sends.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  const step = newest.sequenceStep ?? sends.length;
  if (step > scheduleDays.length) return { state: 'silenced', step };
  const waitMs = scheduleDays[step - 1]! * DAY_MS;
  return { state: nowMs - newest.createdAt >= waitMs ? 'ready' : 'waiting', step };
}
