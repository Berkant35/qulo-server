import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';

async function setup(seed: Tables) {
  const fake = createFakeSupabase({
    reward_market_countries: [{ country_code: 'TH', currency: 'THB', enabled: true, android_enabled: true, ios_enabled: false }],
    user_details: [],
    questions: [],
    ...seed,
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { userService } = await import('../../src/services/user.service.js');
  return { fake, userService };
}

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1', is_deleted: false, country: 'TH', green_diamonds: 1, purple_diamonds: 2, rainbow_diamonds: 3,
  is_test_admin: false, is_seed_profile: false, is_test_account: false, ...over,
});

beforeEach(() => {
  vi.resetModules();
});

describe('userService.getMe — rainbow', () => {
  it('açık ülke + android: rainbow_enabled true ve bakiye döner', async () => {
    const { userService } = await setup({ users: [user()] });
    const me = await userService.getMe('u1', 'android');
    expect(me).toMatchObject({ rainbow_enabled: true, rainbow_diamonds: 3 });
  });

  it('iOS kapalı: rainbow_enabled false (bakiye yine döner, istemci gizler)', async () => {
    const { userService } = await setup({ users: [user()] });
    await expect(userService.getMe('u1', 'ios')).resolves.toMatchObject({ rainbow_enabled: false, rainbow_diamonds: 3 });
  });

  it('iç bayraklar yanıta sızmaz', async () => {
    const { userService } = await setup({ users: [user({ is_test_admin: true })] });
    const me = await userService.getMe('u1', 'android') as Record<string, unknown>;
    expect(me.rainbow_enabled).toBe(true);
    expect(me).not.toHaveProperty('is_test_admin');
    expect(me).not.toHaveProperty('is_seed_profile');
    expect(me).not.toHaveProperty('is_test_account');
  });

  it('has_reward_redemptions yanıtta: true, false; NULL → false', async () => {
    for (const [stored, expected] of [[true, true], [false, false], [null, false]] as const) {
      vi.resetModules();
      const { userService } = await setup({ users: [user({ has_reward_redemptions: stored })] });
      await expect(userService.getMe('u1', 'android')).resolves.toMatchObject({ has_reward_redemptions: expected });
    }
  });
});
