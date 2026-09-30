// src/types/economy-config.schema.ts
import { z } from "zod";

// ── Boundary Constants (shared with watchdog skill) ──
export const ECONOMY_BOUNDARIES = {
  greenDiamondRewardRatio: { min: 0.10, max: 0.50 },
  boostCostGreen: { min: 5, max: 200 },
  boostDurationMinutes: { min: 5, max: 120 },
  greenToPurpleRatio: { min: 1, max: 10 },
  questionCountMultiplier: { min: 0.1, max: 3.0 },
  questionTimeSeconds: { min: 10, max: 120 },
  timeExtendSeconds: { min: 5, max: 60 },
  referralPurple: { min: 5, max: 100 },
  maxCompletedReferrals: { min: 1, max: 50 },
  powerCost: { min: 1, max: 500 },
  /** Yeni kayıtta envantere verilen güç adedi (güç başına). 0 = o güç hediye edilmez. */
  starterPowerQuantity: { min: 0, max: 5 },
  /** Rainbow: abonelik bonusunun "ödenmiş" sayılan payı (0 = hiç rainbow üretmez). */
  rainbowPaidShare: { min: 0, max: 0.5 },
  rainbowMonthlyRedeemCap: { min: 20, max: 500 },
  rainbowMinAccountAgeDays: { min: 0, max: 90 },
  rainbowSuggestedUsd: { min: 0.005, max: 0.07 },
  // Subscription tier boundaries
  free: {
    dailyDiscovers: { min: 10, max: 200 },
    maxQuestions: { min: 2, max: 6 },
    dailyUndos: { min: 0, max: 5 },
    monthlyPurpleBonus: { min: 0, max: 100 },
    chatQuestionDaily: { min: 1, max: 10 },
    chatQuestionUnmatchRisk: { min: 1, max: 5 },
  },
  plus: {
    monthlyPurpleBonus: { min: 100, max: 2000 },
  },
  premium: {
    monthlyPurpleBonus: { min: 500, max: 5000 },
  },
} as const;

const B = ECONOMY_BOUNDARIES;

// ── Sub-schemas ──
const coreSchema = z.object({
  boostCostGreen: z.number().int().min(B.boostCostGreen.min).max(B.boostCostGreen.max),
  boostDurationMinutes: z.number().int().min(B.boostDurationMinutes.min).max(B.boostDurationMinutes.max),
  greenDiamondRewardRatio: z.number().min(B.greenDiamondRewardRatio.min).max(B.greenDiamondRewardRatio.max),
  greenToPurpleRatio: z.number().int().min(B.greenToPurpleRatio.min).max(B.greenToPurpleRatio.max),
  baseAnswerReward: z.number().int().min(1).max(100).default(10),
  questionCountMultipliers: z.record(
    z.string(),
    z.number().min(B.questionCountMultiplier.min).max(B.questionCountMultiplier.max),
  ),
});

const tierLimitsSchema = z.object({
  dailyDiscovers: z.number().int().min(0),
  maxQuestions: z.number().int().min(1).max(20),
  dailyUndos: z.number().int().min(0),
  monthlyPurpleBonus: z.number().int().min(0),
  chatQuestionDaily: z.number().int().min(0),
  chatQuestionUnmatchRisk: z.number().int().min(0),
  passportMode: z.boolean(),
  hasAds: z.boolean(),
});

const subscriptionLimitsSchema = z.object({
  free: tierLimitsSchema,
  plus: tierLimitsSchema,
  premium: tierLimitsSchema,
});

const powerCostSchema = z.object({
  greenCost: z.number().int().min(B.powerCost.min).max(B.powerCost.max),
  purpleCost: z.number().int().min(B.powerCost.min).max(B.powerCost.max),
});

const powerCostsSchema = z.object({
  ORACLE: powerCostSchema,
  HALF: powerCostSchema,
  SKIP: powerCostSchema,
  SKIP_ALL: powerCostSchema,
  TIME_EXTEND: powerCostSchema,
  HINT: powerCostSchema,
  POWER_BLOCK: powerCostSchema,
  POWER_UNBLOCK: powerCostSchema,
});

/** Güç adlarının TEK kaynağı: powerCosts anahtarları. Yeni güç = buraya bir satır, gerisi türetilir. */
const powerNameSchema = powerCostsSchema.keyof();
export const POWER_NAMES = powerNameSchema.options;
export type PowerName = z.infer<typeof powerNameSchema>;

/**
 * Yeni kayıtta envantere verilen başlangıç paketi (karar 2026-09-25: her güçten 1).
 * Önceki sabit (auth.service, yalnız 2× ORACLE) 90 kullanıcının 85'inde hiç kullanılmadan
 * duruyordu; quiz denemelerinin %95'i başarısızdı. Amaç "ilk tadım": kullanıcı her gücün ne
 * yaptığını bir kez bedava görsün, ikinci kullanımda duvar gerçek olsun. Eski config
 * versiyonlarında alan yoksa bu varsayılan uygulanır (retention ile aynı geriye uyum kalıbı).
 */
export const DEFAULT_STARTER_POWERS: Readonly<Record<PowerName, number>> = {
  ORACLE: 1, HALF: 1, SKIP: 1, SKIP_ALL: 1, TIME_EXTEND: 1, HINT: 1, POWER_BLOCK: 1, POWER_UNBLOCK: 1,
};

const starterPowersSchema = z
  .record(
    powerNameSchema,
    z.number().int().min(B.starterPowerQuantity.min).max(B.starterPowerQuantity.max),
  )
  .default({ ...DEFAULT_STARTER_POWERS });

const rewardsSchema = z.object({
  milestones: z.record(z.string(), z.number().int().min(0)),
  referralPurple: z.number().int().min(B.referralPurple.min).max(B.referralPurple.max),
  maxCompletedReferrals: z.number().int().min(B.maxCompletedReferrals.min).max(B.maxCompletedReferrals.max),
  starterPowers: starterPowersSchema,
});

const timingSchema = z.object({
  questionTimeSeconds: z.number().int().min(B.questionTimeSeconds.min).max(B.questionTimeSeconds.max),
  timeExtendSeconds: z.number().int().min(B.timeExtendSeconds.min).max(B.timeExtendSeconds.max),
  timePresets: z.array(z.number().int().min(5).max(300)),
});

// Hesap silme retention teklifi (win-back). Mevcut config'lerde alan yoksa
// default değerler uygulanır — eski config versiyonlarıyla geriye uyumlu.
const retentionSchema = z
  .object({
    deletionDiamondAmount: z.number().int().min(0).max(100).default(15),
    minAccountAgeDays: z.number().int().min(0).max(365).default(7),
  })
  .default({ deletionDiamondAmount: 15, minAccountAgeDays: 7 });

/**
 * Rainbow (spec 2026-09-27). Abonelik moru "yarı ödenmiş": birim maliyeti IAP'nin çok altında
 * (Premium 0,67 sent/mor). Tamamı ödenmiş sayılsaydı Premium bonusu 450 rainbow = 13,50 $ kupon
 * üretirdi, aboneden net 6,99 $ — her farmer -6,51 $. Pay tier başına: plus 0,30, premium 0,20
 * → yük/net ~%39, IAP (%43) ile aynı bant. Eski config'lerde blok yoksa bu varsayılanlar.
 */
export const DEFAULT_RAINBOW = {
  /**
   * Ana anahtar (kullanıcı kararı 2026-09-30): kapalıyken Rainbow + market yalnız iç test hesaplarına
   * (`is_test_account`) görünür; açıkken test admin + ülke/platform kuralları. Karar tek yerde:
   * `rainbowAccessService`. Anahtar yoksa KAPALI — eski config sürümleri kendiliğinden kapalı kalır.
   */
  enabled: false,
  subscriptionPaidShare: { free: 0, plus: 0.3, premium: 0.2 },
  monthlyRedeemCap: 150,
  minAccountAgeDays: 30,
  suggestedUsdPerRainbow: 0.03,
} as const;

const paidShareSchema = z.number().min(B.rainbowPaidShare.min).max(B.rainbowPaidShare.max);

const rainbowSchema = z
  .object({
    enabled: z.boolean().default(DEFAULT_RAINBOW.enabled),
    subscriptionPaidShare: z
      .object({ free: paidShareSchema, plus: paidShareSchema, premium: paidShareSchema })
      .default({ ...DEFAULT_RAINBOW.subscriptionPaidShare }),
    monthlyRedeemCap: z.number().int()
      .min(B.rainbowMonthlyRedeemCap.min).max(B.rainbowMonthlyRedeemCap.max)
      .default(DEFAULT_RAINBOW.monthlyRedeemCap),
    minAccountAgeDays: z.number().int()
      .min(B.rainbowMinAccountAgeDays.min).max(B.rainbowMinAccountAgeDays.max)
      .default(DEFAULT_RAINBOW.minAccountAgeDays),
    suggestedUsdPerRainbow: z.number()
      .min(B.rainbowSuggestedUsd.min).max(B.rainbowSuggestedUsd.max)
      .default(DEFAULT_RAINBOW.suggestedUsdPerRainbow),
  })
  .default({
    enabled: DEFAULT_RAINBOW.enabled,
    subscriptionPaidShare: { ...DEFAULT_RAINBOW.subscriptionPaidShare },
    monthlyRedeemCap: DEFAULT_RAINBOW.monthlyRedeemCap,
    minAccountAgeDays: DEFAULT_RAINBOW.minAccountAgeDays,
    suggestedUsdPerRainbow: DEFAULT_RAINBOW.suggestedUsdPerRainbow,
  });

// ── Main schema ──
export const economyConfigSchema = z.object({
  core: coreSchema,
  subscriptionLimits: subscriptionLimitsSchema,
  rewards: rewardsSchema,
  timing: timingSchema,
  powerCosts: powerCostsSchema,
  retention: retentionSchema,
  rainbow: rainbowSchema,
});

// ── TypeScript types (inferred from Zod) ──
export type EconomyConfig = z.infer<typeof economyConfigSchema>;
export type EconomyCore = z.infer<typeof coreSchema>;
export type TierLimits = z.infer<typeof tierLimitsSchema>;
export type SubscriptionLimitsConfig = z.infer<typeof subscriptionLimitsSchema>;
export type RewardsConfig = z.infer<typeof rewardsSchema>;
export type TimingConfig = z.infer<typeof timingSchema>;
export type PowerCostsConfig = z.infer<typeof powerCostsSchema>;
export type RetentionConfig = z.infer<typeof retentionSchema>;
export type RainbowConfig = z.infer<typeof rainbowSchema>;

export interface EconomyConfigVersion {
  id: string;
  version: number;
  config: EconomyConfig;
  is_active: boolean;
  changed_by: string | null;
  change_reason: string;
  created_at: string;
}

export interface ConfigDiff {
  v1: number;
  v2: number;
  changes: Array<{
    path: string;
    oldValue: unknown;
    newValue: unknown;
  }>;
}
