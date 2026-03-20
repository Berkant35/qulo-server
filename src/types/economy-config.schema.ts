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

const rewardsSchema = z.object({
  milestones: z.record(z.string(), z.number().int().min(0)),
  referralPurple: z.number().int().min(B.referralPurple.min).max(B.referralPurple.max),
  maxCompletedReferrals: z.number().int().min(B.maxCompletedReferrals.min).max(B.maxCompletedReferrals.max),
});

const timingSchema = z.object({
  questionTimeSeconds: z.number().int().min(B.questionTimeSeconds.min).max(B.questionTimeSeconds.max),
  timeExtendSeconds: z.number().int().min(B.timeExtendSeconds.min).max(B.timeExtendSeconds.max),
  timePresets: z.array(z.number().int().min(5).max(300)),
});

// ── Main schema ──
export const economyConfigSchema = z.object({
  core: coreSchema,
  subscriptionLimits: subscriptionLimitsSchema,
  rewards: rewardsSchema,
  timing: timingSchema,
});

// ── TypeScript types (inferred from Zod) ──
export type EconomyConfig = z.infer<typeof economyConfigSchema>;
export type EconomyCore = z.infer<typeof coreSchema>;
export type TierLimits = z.infer<typeof tierLimitsSchema>;
export type SubscriptionLimitsConfig = z.infer<typeof subscriptionLimitsSchema>;
export type RewardsConfig = z.infer<typeof rewardsSchema>;
export type TimingConfig = z.infer<typeof timingSchema>;

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
