import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';

/** Fixture: HALF yeşil fiyatı 30 → rainbow fiyatı da 30. */
async function setup(seed: Tables) {
  const fake = createFakeSupabase({
    economy_config_versions: [activeConfigRow()],
    reward_market_countries: [{ country_code: 'TH', currency: 'THB', enabled: true, android_enabled: true, ios_enabled: false }],
    powers: [{ id: 'p-half', name: 'HALF', is_active: true, green_cost: 30, purple_cost: 10, base_cost: 10 }],
    user_power_inventory: [],
    power_purchase_transactions: [],
    ...seed,
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { exchangeService } = await import('../../src/services/exchange.service.js');
  return { fake, exchangeService };
}

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1', green_diamonds: 0, purple_diamonds: 0, purple_paid: 0, rainbow_diamonds: 100,
  country: 'TH', is_test_admin: false, is_seed_profile: false, is_test_account: false, ...over,
});

beforeEach(() => {
  vi.resetModules();
});

describe('ExchangeService.buyPower — RAINBOW', () => {
  it('erişimi açık kullanıcı yeşil fiyatına rainbow ile alır', async () => {
    const { fake, exchangeService } = await setup({ users: [user()] });
    await expect(exchangeService.buyPower('u1', 'HALF', 'RAINBOW', 2, 'android')).resolves.toMatchObject({
      new_count: 2, new_balance: { green: 0, purple: 0, rainbow: 40 },
    });
    expect(fake.table('power_purchase_transactions')[0]).toMatchObject({ diamond_type: 'RAINBOW', total_cost: 60 });
    expect(fake.table('diamond_transactions')[0]).toMatchObject({ type: 'RAINBOW', amount: -60, reason: 'buy_power_HALF' });
  });

  it('erişimi kapalı kullanıcı (iOS kapalı) reddedilir ve hiçbir şey düşmez', async () => {
    const { fake, exchangeService } = await setup({ users: [user()] });
    await expect(exchangeService.buyPower('u1', 'HALF', 'RAINBOW', 1, 'ios')).rejects.toMatchObject({
      code: 'RAINBOW_NOT_AVAILABLE', statusCode: 403,
    });
    expect(fake.table('users')[0].rainbow_diamonds).toBe(100);
  });

  it('arka planda birikmiş rainbow (TR) harcanamaz', async () => {
    const { exchangeService } = await setup({ users: [user({ country: 'TR' })] });
    await expect(exchangeService.buyPower('u1', 'HALF', 'RAINBOW', 1, 'android')).rejects.toMatchObject({
      code: 'RAINBOW_NOT_AVAILABLE',
    });
  });

  it('yetersiz rainbow INSUFFICIENT_DIAMONDS', async () => {
    const { exchangeService } = await setup({ users: [user({ rainbow_diamonds: 10 })] });
    await expect(exchangeService.buyPower('u1', 'HALF', 'RAINBOW', 1, 'android')).rejects.toMatchObject({
      code: 'INSUFFICIENT_DIAMONDS',
    });
  });
});
