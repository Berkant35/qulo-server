import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createFakeSupabase,
  type FakeSupabase,
  type FakeSupabaseOptions,
  type Tables,
} from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';

const NOW = new Date('2026-09-27T12:00:00Z');
const KEY = '11111111-1111-4111-8111-111111111111';
const KEY2 = '22222222-2222-4222-8222-222222222222';

async function setup(seed: Tables, options: FakeSupabaseOptions = {}) {
  const fake = createFakeSupabase(
    {
      economy_config_versions: [activeConfigRow()],
      reward_market_countries: [
        { country_code: 'TH', currency: 'THB', enabled: true, android_enabled: true, ios_enabled: false },
        { country_code: 'ID', currency: 'IDR', enabled: false, android_enabled: true, ios_enabled: false },
      ],
      reward_catalog_items: [
        { id: 'i-grab', brand_key: 'GRAB', country_code: 'TH', currency: 'THB', face_value: 50, cost_usd: 1.51, rainbow_price: 51, is_active: true, sort_order: 1, logo_url: null, deleted_at: null },
        { id: 'i-off', brand_key: 'TRUEMONEY', country_code: 'TH', currency: 'THB', face_value: 20, cost_usd: 0.64, rainbow_price: 22, is_active: false, sort_order: 0, logo_url: null, deleted_at: null },
        { id: 'i-gone', brand_key: 'LINEMAN', country_code: 'TH', currency: 'THB', face_value: 100, cost_usd: 3.03, rainbow_price: 101, is_active: true, sort_order: 0, logo_url: null, deleted_at: '2026-09-20T00:00:00Z' },
        { id: 'i-dana', brand_key: 'DANA', country_code: 'ID', currency: 'IDR', face_value: 10000, cost_usd: 0.6, rainbow_price: 20, is_active: true, sort_order: 0, logo_url: null, deleted_at: null },
      ],
      reward_redemptions: [],
      diamond_transactions: [],
      ...seed,
    },
    { unique: { reward_redemptions: ['user_id,idempotency_key'] }, ...options },
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { rewardsMarketService } = await import('../../src/services/rewards-market.service.js');
  return { fake, rewardsMarketService };
}

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1', country: 'TH', created_at: '2026-08-01T00:00:00Z', green_diamonds: 0, purple_diamonds: 0,
  purple_paid: 0, rainbow_diamonds: 200, is_test_admin: false, is_seed_profile: false, is_test_account: false,
  ...over,
});

const existing = (over: Record<string, unknown>) => ({
  id: 'r-x', user_id: 'u1', item_id: 'i-grab', status: 'PENDING', rainbow_price: 51, brand_key: 'GRAB',
  country_code: 'TH', currency: 'THB', face_value: 50, delivery_code: null, delivery_url: null,
  admin_note: null, reject_reason: null, idempotency_key: 'k-x-000000', platform: 'android', is_test: false,
  created_at: '2026-09-10T00:00:00Z', decided_at: null, decided_by: null,
  ...over,
});

const input = (over: Partial<{ itemId: string; idempotencyKey: string }> = {}) => ({
  itemId: 'i-grab', idempotencyKey: KEY, ...over,
});

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rewardsMarketService.redeem — mutlu yol', () => {
  it('rainbow düşer, PENDING talep anlık görüntüyle açılır, defter satırı talebe bağlı', async () => {
    const { fake, rewardsMarketService } = await setup({ users: [user()] });
    const result = await rewardsMarketService.redeem('u1', input(), 'android');

    expect(result.balance).toBe(149);
    expect(result.redemption).toMatchObject({
      status: 'PENDING', brand_key: 'GRAB', country_code: 'TH', currency: 'THB', face_value: 50, rainbow_price: 51,
    });
    expect(fake.table('users')[0].rainbow_diamonds).toBe(149);

    const [row] = fake.table('reward_redemptions');
    expect(row).toMatchObject({
      id: result.redemption.id, user_id: 'u1', item_id: 'i-grab', idempotency_key: KEY,
      platform: 'android', is_test: false,
    });
    expect(fake.table('diamond_transactions')).toEqual([
      expect.objectContaining({
        type: 'RAINBOW', amount: -51, reason: 'REWARD_REDEEM', reference_id: `redemption:${result.redemption.id}`,
      }),
    ]);
  });

  it('aynı anahtarla tekrar: aynı talep döner, ikinci kez düşmez', async () => {
    const { fake, rewardsMarketService } = await setup({ users: [user()] });
    const first = await rewardsMarketService.redeem('u1', input(), 'android');
    const second = await rewardsMarketService.redeem('u1', input(), 'android');

    expect(second.redemption.id).toBe(first.redemption.id);
    expect(second.balance).toBe(149);
    expect(fake.table('reward_redemptions')).toHaveLength(1);
    expect(fake.table('diamond_transactions')).toHaveLength(1);
  });

  it('tekrar, erişim sonradan kapansa da mevcut talebi döner (kural kapılarından önce)', async () => {
    const { rewardsMarketService } = await setup({
      users: [user({ country: 'TR' })],
      reward_redemptions: [existing({ id: 'r-old', idempotency_key: KEY })],
    });
    const result = await rewardsMarketService.redeem('u1', input(), 'android');
    expect(result.redemption.id).toBe('r-old');
  });

  it('test admin: başka ülkenin ürünü, yeni hesap, tavan üstü — hepsi geçer; talep is_test, web → platform null', async () => {
    const { fake, rewardsMarketService } = await setup({
      users: [user({ country: 'TR', is_test_admin: true, created_at: '2026-09-26T00:00:00Z', rainbow_diamonds: 500 })],
      reward_redemptions: [existing({ id: 'r-big', status: 'FULFILLED', rainbow_price: 150, created_at: '2026-09-02T00:00:00Z' })],
    });
    await rewardsMarketService.redeem('u1', input({ itemId: 'i-dana' }), 'web');

    const created = fake.table('reward_redemptions').find((r) => r.idempotency_key === KEY);
    expect(created).toMatchObject({ item_id: 'i-dana', country_code: 'ID', is_test: true, platform: null });
  });
});

describe('rewardsMarketService.redeem — kural kapıları (her biri tek başına kırmızı)', () => {
  it.each([
    ['market dışı ülke', { country: 'TR' }, 'android'],
    ['kapalı platform (TH iOS)', {}, 'ios'],
    ['seed profil', { is_seed_profile: true }, 'android'],
    ['test hesabı', { is_test_account: true }, 'android'],
  ] as const)('%s → RAINBOW_NOT_AVAILABLE, hiçbir şey yazılmaz', async (_name, over, platform) => {
    const { fake, rewardsMarketService } = await setup({ users: [user(over)] });
    await expect(rewardsMarketService.redeem('u1', input(), platform)).rejects.toMatchObject({
      code: 'RAINBOW_NOT_AVAILABLE',
    });
    expect(fake.table('users')[0].rainbow_diamonds).toBe(200);
    expect(fake.table('reward_redemptions')).toHaveLength(0);
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it('hesap 30 günden yeni → REWARD_ACCOUNT_TOO_NEW (minDays 30)', async () => {
    const { fake, rewardsMarketService } = await setup({ users: [user({ created_at: '2026-09-17T12:00:00Z' })] });
    await expect(rewardsMarketService.redeem('u1', input(), 'android')).rejects.toMatchObject({
      code: 'REWARD_ACCOUNT_TOO_NEW', params: { minDays: 30 },
    });
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it.each([
    ['pasif ürün', 'i-off'],
    ['silinmiş ürün', 'i-gone'],
    ['başka ülkenin ürünü (TH kullanıcı, ID ürün)', 'i-dana'],
    ['olmayan ürün', '99999999-9999-4999-8999-999999999999'],
  ])('%s → REWARD_ITEM_UNAVAILABLE', async (_name, itemId) => {
    const { fake, rewardsMarketService } = await setup({ users: [user()] });
    await expect(rewardsMarketService.redeem('u1', input({ itemId }), 'android')).rejects.toMatchObject({
      code: 'REWARD_ITEM_UNAVAILABLE',
    });
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it('aylık tavan: bu ay 120 (PENDING+FULFILLED) + 51 > 150 → REWARD_MONTHLY_CAP; REJECTED ve geçen ay sayılmaz', async () => {
    const { fake, rewardsMarketService } = await setup({
      users: [user()],
      reward_redemptions: [
        existing({ id: 'r1', status: 'PENDING', rainbow_price: 60, created_at: '2026-09-03T00:00:00Z', idempotency_key: 'k1-000000' }),
        existing({ id: 'r2', status: 'FULFILLED', rainbow_price: 60, created_at: '2026-09-04T00:00:00Z', idempotency_key: 'k2-000000' }),
        existing({ id: 'r3', status: 'REJECTED', rainbow_price: 100, created_at: '2026-09-05T00:00:00Z', idempotency_key: 'k3-000000' }),
        existing({ id: 'r4', status: 'FULFILLED', rainbow_price: 100, created_at: '2026-08-30T00:00:00Z', idempotency_key: 'k4-000000' }),
      ],
    });
    await expect(rewardsMarketService.redeem('u1', input(), 'android')).rejects.toMatchObject({
      code: 'REWARD_MONTHLY_CAP', params: { cap: 150, used: 120 },
    });
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it('tavanın tam sınırı geçer: 99 + 51 = 150', async () => {
    const { rewardsMarketService } = await setup({
      users: [user()],
      reward_redemptions: [existing({ id: 'r1', status: 'PENDING', rainbow_price: 99, created_at: '2026-09-03T00:00:00Z', idempotency_key: 'k1-000000' })],
    });
    await expect(rewardsMarketService.redeem('u1', input(), 'android')).resolves.toMatchObject({ balance: 149 });
  });

  it('yetersiz rainbow → INSUFFICIENT_DIAMONDS, talep açılmaz', async () => {
    const { fake, rewardsMarketService } = await setup({ users: [user({ rainbow_diamonds: 10 })] });
    await expect(rewardsMarketService.redeem('u1', input(), 'android')).rejects.toMatchObject({
      code: 'INSUFFICIENT_DIAMONDS',
    });
    expect(fake.table('reward_redemptions')).toHaveLength(0);
    expect(fake.table('users')[0].rainbow_diamonds).toBe(10);
  });
});

describe('rewardsMarketService.redeem — telafi', () => {
  it('talep yazılamazsa düşülen rainbow iade edilir ve SERVER_ERROR döner', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fake, rewardsMarketService } = await setup(
      { users: [user()] },
      { failOn: [{ table: 'reward_redemptions', op: 'insert' }] },
    );
    await expect(rewardsMarketService.redeem('u1', input(), 'android')).rejects.toMatchObject({ code: 'SERVER_ERROR' });

    expect(fake.table('users')[0].rainbow_diamonds).toBe(200);
    const ledger = fake.table('diamond_transactions');
    expect(ledger.map((t) => [t.amount, t.reason])).toEqual([[-51, 'REWARD_REDEEM'], [51, 'REWARD_REFUND']]);
    expect(ledger[0].reference_id).toBe(ledger[1].reference_id);
    errorSpy.mockRestore();
  });

  it('aynı anahtarla eşzamanlı istek kazanırsa (23505): kaybeden iade edilir, kazanan talep döner', async () => {
    let fakeRef: FakeSupabase | undefined;
    const winner = existing({ id: 'r-winner', idempotency_key: KEY, created_at: '2026-09-27T11:59:59Z' });
    const { fake, rewardsMarketService } = await setup(
      { users: [user()] },
      {
        // Ön kontrol (findByKey) boş görür; rainbow düşümü sırasında diğer istek talebini yazar.
        interleave: [{ table: 'users', mutate: () => { fakeRef!.table('reward_redemptions').push({ ...winner }); } }],
      },
    );
    fakeRef = fake;

    const result = await rewardsMarketService.redeem('u1', input(), 'android');

    expect(result.redemption.id).toBe('r-winner');
    expect(fake.table('reward_redemptions')).toHaveLength(1);
    expect(fake.table('users')[0].rainbow_diamonds).toBe(200);
    expect(fake.table('diamond_transactions').map((t) => t.reason)).toEqual(['REWARD_REDEEM', 'REWARD_REFUND']);
  });

  it('farklı anahtarla ikinci talep ayrı talep açar', async () => {
    const { fake, rewardsMarketService } = await setup({ users: [user()] });
    await rewardsMarketService.redeem('u1', input(), 'android');
    await rewardsMarketService.redeem('u1', input({ idempotencyKey: KEY2 }), 'android');
    expect(fake.table('reward_redemptions')).toHaveLength(2);
    expect(fake.table('users')[0].rainbow_diamonds).toBe(98);
  });
});
