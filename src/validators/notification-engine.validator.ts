import { z } from 'zod';
import { LIFECYCLE_RULE_KEYS, LIFECYCLE_RULES_BY_KEY } from '../services/notification-engine/rules.js';
import type { LifecycleRuleKey } from '../services/notification-engine/rules.js';

export const MAX_SCHEDULE_STEPS = 10;
/** Tek adim push_log saklama suresine (90) yaklasirsa son kayit budanir ve dizi bastan baslar; 60 guvenli pay. */
export const MAX_SCHEDULE_STEP_DAYS = 60;

export const ruleConfigSchema = z.object({
  enabled: z.boolean(),
  /** Gonderimler arasi gunler; bos = tek gonderim. Dizi bitince kural o kullanici icin susar (sequence.ts). */
  schedule_days: z.array(z.number().int().min(1).max(MAX_SCHEDULE_STEP_DAYS)).max(MAX_SCHEDULE_STEPS),
});

const rulesShape = Object.fromEntries(LIFECYCLE_RULE_KEYS.map((k) => [k, ruleConfigSchema])) as Record<
  LifecycleRuleKey,
  typeof ruleConfigSchema
>;

export const engineConfigSchema = z.object({
  enabled: z.boolean(),
  /** true → karar uretilir, push_log'a yazilir, gonderilmez. Ilk canli kosum boyle dogrulanir. */
  dry_run: z.boolean(),
  /** Kullanicinin yerel saatiyle gonderim saati (0-23). */
  send_hour_local: z.number().int().min(0).max(23),
  daily_cap: z.number().int().min(1).max(5),
  weekly_cap: z.number().int().min(1).max(20),
  holdout_pct: z.number().int().min(0).max(50),
  max_per_run: z.number().int().min(1).max(1000),
  rules: z.object(rulesShape),
});

export type EngineConfig = z.infer<typeof engineConfigSchema>;
export type RuleConfig = z.infer<typeof ruleConfigSchema>;

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  enabled: true,
  dry_run: true,
  send_hour_local: 19,
  daily_cap: 1,
  weekly_cap: 3,
  holdout_pct: 0,
  max_per_run: 200,
  rules: Object.fromEntries(
    LIFECYCLE_RULE_KEYS.map((k) => [k, { enabled: true, schedule_days: [...LIFECYCLE_RULES_BY_KEY[k].defaultScheduleDays] }]),
  ) as EngineConfig['rules'],
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * DB'deki ham JSON'u varsayilanlarla birlestirir ve dogrular.
 * Bilinmeyen anahtarlar atilir; gecersiz deger varsa TAMAMI varsayilana doner (yarim config yok).
 */
export function mergeEngineConfig(raw: unknown): { config: EngineConfig; valid: boolean } {
  const source = isRecord(raw) ? raw : {};
  const rawRules = isRecord(source.rules) ? source.rules : {};
  const merged = {
    ...DEFAULT_ENGINE_CONFIG,
    ...source,
    rules: Object.fromEntries(
      LIFECYCLE_RULE_KEYS.map((k) => [
        k,
        { ...DEFAULT_ENGINE_CONFIG.rules[k], ...(isRecord(rawRules[k]) ? rawRules[k] : {}) },
      ]),
    ),
  };
  const parsed = engineConfigSchema.safeParse(merged);
  if (parsed.success) return { config: parsed.data, valid: true };
  return { config: DEFAULT_ENGINE_CONFIG, valid: false };
}

/**
 * "2, 4, 7" → [2,4,7]; bos string → [] (tek gonderim); alan hic gelmemisse mevcut deger korunur (kismi form);
 * gecersiz parca → NaN (zod reddeder). Fazla parca kirpilir ki hata listesi sismesin (.max zaten reddeder).
 */
export function parseScheduleField(raw: unknown, current: number[]): number[] {
  if (raw === undefined) return current;
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  return raw
    .split(/[,\s]+/)
    .filter(Boolean)
    .slice(0, MAX_SCHEDULE_STEPS + 1)
    .map((v) => (/^\d+$/.test(v) ? Number(v) : Number.NaN));
}

function intField(body: Record<string, unknown>, key: string, fallback: number): number {
  const raw = body[key];
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Backoffice formu (urlencoded) → EngineConfig. Checkbox'lar yalnizca isaretliyse gelir ("on"). */
export function parseEngineConfigForm(body: Record<string, unknown>, current: EngineConfig): ReturnType<typeof engineConfigSchema.safeParse> {
  const candidate = {
    enabled: body.enabled === 'on',
    dry_run: body.dry_run === 'on',
    send_hour_local: intField(body, 'send_hour_local', current.send_hour_local),
    daily_cap: intField(body, 'daily_cap', current.daily_cap),
    weekly_cap: intField(body, 'weekly_cap', current.weekly_cap),
    holdout_pct: intField(body, 'holdout_pct', current.holdout_pct),
    max_per_run: intField(body, 'max_per_run', current.max_per_run),
    rules: Object.fromEntries(
      LIFECYCLE_RULE_KEYS.map((k) => [
        k,
        {
          enabled: body[`rule_${k}_enabled`] === 'on',
          schedule_days: parseScheduleField(body[`rule_${k}_schedule`], current.rules[k].schedule_days),
        },
      ]),
    ),
  };
  return engineConfigSchema.safeParse(candidate);
}
