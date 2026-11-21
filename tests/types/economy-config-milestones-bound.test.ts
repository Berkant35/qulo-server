import { describe, it, expect } from 'vitest';
import { economyConfigSchema, ECONOMY_BOUNDARIES } from '../../src/types/economy-config.schema.js';
import { economyConfigFixture } from '../helpers/economy-config.fixture.js';

// Profil tamamlama odulleri artik config'ten yatiyor (user.service.resolveProfileMilestones):
// sinirsiz bir deger (hatali admin girdisi) tek tamamlama ile sinirsiz mor basardi.
describe('economy config — rewards.milestones sinirlari', () => {
  const withMilestones = (milestones: Record<string, number>) => ({
    ...economyConfigFixture,
    rewards: { ...economyConfigFixture.rewards, milestones },
  });

  it('sinir icindeki odul kabul edilir', () => {
    const max = ECONOMY_BOUNDARIES.milestoneReward.max;
    expect(economyConfigSchema.safeParse(withMilestones({ '25': 2, '100': max })).success).toBe(true);
  });

  it('sinirin ustundeki odul reddedilir', () => {
    const max = ECONOMY_BOUNDARIES.milestoneReward.max;
    expect(economyConfigSchema.safeParse(withMilestones({ '100': max + 1 })).success).toBe(false);
    expect(economyConfigSchema.safeParse(withMilestones({ '100': 1_000_000 })).success).toBe(false);
  });

  it('esik 1..100 tam sayi disinda reddedilir', () => {
    expect(economyConfigSchema.safeParse(withMilestones({ '-5': 2 })).success).toBe(false);
    expect(economyConfigSchema.safeParse(withMilestones({ '0': 2 })).success).toBe(false);
    expect(economyConfigSchema.safeParse(withMilestones({ '101': 2 })).success).toBe(false);
    expect(economyConfigSchema.safeParse(withMilestones({ abc: 2 })).success).toBe(false);
  });
});
