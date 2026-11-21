import type { LifecycleRuleKey } from './rules.js';
import { LOCAL_SCHEDULE_RULES } from '../../validators/local-schedule.validator.js';
import type { LocalScheduleRule } from '../../validators/local-schedule.validator.js';

/**
 * Yerel (istemci planli) kural → AYNI KONUYU anlatan sunucu kurallari. Yerel plan `until`'e dek gecerliyken
 * motor bu sunucu kurallarini o kullanici icin atlar; digerleri (unread_message, match_waiting, likes_waiting,
 * profile_incomplete) etkilenmez — yerel taraf bunlari hic planlamaz.
 *
 *  quiz_unfinished → lifecycle_quiz_unfinished  (ayni konu: yarim kalan quiz)
 *  new_people      → lifecycle_new_people       (ayni konu: yeni katilanlar)
 *  return_3d/7d    → lifecycle_new_people       Yerel metinler "sen yokken yeni insanlar katildi" = new_people konusu;
 *                    new_people 3-30 gun inaktif kullaniciya gider, yani return_3d/7d ile ayni pencerede ve ayni
 *                    mesajla cakisir. day1_return (kayittan 4-30 saat) return_3d (72 sa+) ile ZAMANDA hic kesismez ve
 *                    yeni her kullanicida return_3d planli olacagindan day1_return'u bastirmak onu tamamen oldurur;
 *                    winback (30+ gun) `until` (<= 8 gun) sonrasina duser, hic cakismaz → ikisi de eslenmez.
 *  limit_refreshed → (yok)                      Sunucuda "limit yenilendi" kurali yok; ad kabul edilir, etkisi bos.
 */
export const LOCAL_TO_SERVER_RULES: Record<LocalScheduleRule, readonly LifecycleRuleKey[]> = {
  quiz_unfinished: ['lifecycle_quiz_unfinished'],
  limit_refreshed: [],
  new_people: ['lifecycle_new_people'],
  return_3d: ['lifecycle_new_people'],
  return_7d: ['lifecycle_new_people'],
};

const NONE: ReadonlySet<LifecycleRuleKey> = new Set();

/**
 * users.local_schedule (ham jsonb) → bu an atlanacak sunucu kurallari. Bozuk/eksik/suresi gecmis kayit = bos
 * (fail-open: yerel plan dogrulanamazsa sunucu push'u gonderilir; cift bildirim, kayip bildirimden iyidir).
 */
export function suppressedByLocalSchedule(raw: unknown, nowMs: number): ReadonlySet<LifecycleRuleKey> {
  if (!raw || typeof raw !== 'object') return NONE;
  const { rules, until } = raw as { rules?: unknown; until?: unknown };
  if (!Array.isArray(rules) || typeof until !== 'string') return NONE;
  const untilMs = Date.parse(until);
  if (!Number.isFinite(untilMs) || untilMs <= nowMs) return NONE;
  const out = new Set<LifecycleRuleKey>();
  for (const r of rules) {
    if (!(LOCAL_SCHEDULE_RULES as readonly unknown[]).includes(r)) continue;
    for (const key of LOCAL_TO_SERVER_RULES[r as LocalScheduleRule]) out.add(key);
  }
  return out;
}
