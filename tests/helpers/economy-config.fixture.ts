import type { EconomyConfig } from '../../src/types/economy-config.schema.js';

/**
 * economyConfigSchema'yı geçen geçerli bir config.
 * `economy_config_versions` tablosuna seed edilir; servis gerçek zod parse'ını çalıştırır,
 * yani fixture bozulursa test schema hatası verir — sessizce yanlış değer kullanmaz.
 */
export const economyConfigFixture: EconomyConfig = {
  core: {
    boostCostGreen: 20,
    boostDurationMinutes: 30,
    greenDiamondRewardRatio: 0.25,
    greenToPurpleRatio: 3,
    baseAnswerReward: 10,
    questionCountMultipliers: { '2': 1.0, '5': 1.5 },
  },
  subscriptionLimits: {
    free: {
      dailyDiscovers: 50, maxQuestions: 3, dailyUndos: 0, monthlyPurpleBonus: 0,
      chatQuestionDaily: 1, chatQuestionUnmatchRisk: 1, passportMode: false, hasAds: true,
    },
    plus: {
      dailyDiscovers: 200, maxQuestions: 5, dailyUndos: 3, monthlyPurpleBonus: 200,
      chatQuestionDaily: 5, chatQuestionUnmatchRisk: 2, passportMode: true, hasAds: false,
    },
    premium: {
      dailyDiscovers: 500, maxQuestions: 10, dailyUndos: 10, monthlyPurpleBonus: 1000,
      chatQuestionDaily: 10, chatQuestionUnmatchRisk: 3, passportMode: true, hasAds: false,
    },
  },
  rewards: {
    milestones: { '10': 5, '50': 25 },
    referralPurple: 20,
    maxCompletedReferrals: 10,
  },
  timing: {
    questionTimeSeconds: 30,
    timeExtendSeconds: 15,
    timePresets: [15, 30, 60],
  },
  powerCosts: {
    ORACLE: { greenCost: 45, purpleCost: 15 },
    HALF: { greenCost: 30, purpleCost: 10 },
    SKIP: { greenCost: 24, purpleCost: 8 },
    SKIP_ALL: { greenCost: 60, purpleCost: 20 },
    TIME_EXTEND: { greenCost: 15, purpleCost: 5 },
    HINT: { greenCost: 21, purpleCost: 7 },
    POWER_BLOCK: { greenCost: 36, purpleCost: 12 },
    POWER_UNBLOCK: { greenCost: 36, purpleCost: 12 },
  },
  retention: {
    deletionDiamondAmount: 15,
    minAccountAgeDays: 7,
  },
};

/** `economy_config_versions` tablosuna seed edilebilir satır. */
export function activeConfigRow(overrides: Partial<EconomyConfig> = {}) {
  return {
    id: 'cfg-1',
    version: 1,
    config: { ...economyConfigFixture, ...overrides },
    is_active: true,
    changed_by: null,
    change_reason: 'test fixture',
    created_at: '2026-01-01T00:00:00Z',
  };
}
