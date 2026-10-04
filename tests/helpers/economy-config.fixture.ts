import { DEFAULT_QUIZ_ONBOARDING, DEFAULT_QUIZ_TIMING, DEFAULT_STARTER_POWERS, type EconomyConfig } from '../../src/types/economy-config.schema.js';

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
    starterPowers: { ...DEFAULT_STARTER_POWERS },
  },
  timing: {
    questionTimeSeconds: 30,
    timeExtendSeconds: 15,
    timePresets: [15, 30, 60],
    ...DEFAULT_QUIZ_TIMING,
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
  rainbow: {
    // Testler varsayılan olarak YAYINDAKİ davranışı (ana anahtar açık) sınar; prod varsayılanı kapalı.
    // Kapalı hal için `rainbowSwitchRow(false)`.
    enabled: true,
    subscriptionPaidShare: { free: 0, plus: 0.3, premium: 0.2 },
    monthlyRedeemCap: 150,
    minAccountAgeDays: 30,
    suggestedUsdPerRainbow: 0.03,
  },
  quizOnboarding: { ...DEFAULT_QUIZ_ONBOARDING },
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

/** Rainbow ana anahtarı (`rainbow.enabled`) verilen durumda olan etkin config satırı. */
export function rainbowSwitchRow(enabled: boolean) {
  return activeConfigRow({ rainbow: { ...economyConfigFixture.rainbow, enabled } });
}

/** Eski config versiyonu: `rewards.starterPowers` alanı hiç yok (varsayılan devreye girmeli). */
export function rewardsWithoutStarterPowers(): Omit<EconomyConfig['rewards'], 'starterPowers'> {
  const { starterPowers: _omit, ...rest } = economyConfigFixture.rewards;
  return rest;
}

/** Eski config versiyonu: `rainbow` bloğu hiç yok (varsayılan devreye girmeli). */
export function configWithoutRainbow(): Omit<EconomyConfig, 'rainbow'> {
  const { rainbow: _omit, ...rest } = economyConfigFixture;
  return rest;
}
