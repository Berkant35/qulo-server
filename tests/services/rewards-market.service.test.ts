import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';
import { activeConfigRow, rainbowSwitchRow } from '../helpers/economy-config.fixture.js';

const NOW = new Date('2026-09-27T12:00:00Z');

async function setup(seed: Tables, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase(
    {
      economy_config_versions: [activeConfigRow()],
      reward_market_countries: [
        { country_code: 'TH', currency: 'THB', enabled: true, android_enabled: true, ios_enabled: false },
        { country_code: 'ID', currency: 'IDR', enabled: false, android_enabled: true, ios_enabled: false },
      ],
      reward_catalog_items: [
        { id: 'i-lineman', brand_key: 'LINEMAN', country_code: 'TH', currency: 'THB', face_value: 100, cost_usd: 3.03, rainbow_price: 101, is_active: true, sort_order: 2, logo_url: null, deleted_at: null },
        { id: 'i-grab', brand_key: 'GRAB', country_code: 'TH', currency: 'THB', face_value: 50, cost_usd: 1.51, rainbow_price: 51, is_active: true, sort_order: 1, logo_url: 'https://cdn.example/grab.png', deleted_at: null },
        { id: 'i-true', brand_key: 'TRUEMONEY', country_code: 'TH', currency: 'THB', face_value: 20, cost_usd: 0.64, rainbow_price: 22, is_active: false, sort_order: 0, logo_url: null, deleted_at: null },
        { id: 'i-gone', brand_key: 'GRAB', country_code: 'TH', currency: 'THB', face_value: 500, cost_usd: 15, rainbow_price: 500, is_active: true, sort_order: 0, logo_url: null, deleted_at: '2026-09-20T00:00:00Z' },
        { id: 'i-dana', brand_key: 'DANA', country_code: 'ID', currency: 'IDR', face_value: 10000, cost_usd: 0.6, rainbow_price: 20, is_active: true, sort_order: 0, logo_url: null, deleted_at: null },
      ],
      reward_redemptions: [],
      diamond_transactions: [],
      ...seed,
    },
    options,
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

const redemption = (over: Record<string, unknown>) => ({
  id: 'r-x', user_id: 'u1', item_id: 'i-grab', status: 'PENDING', rainbow_price: 51, brand_key: 'GRAB',
  country_code: 'TH', currency: 'THB', face_value: 50, delivery_code: null, delivery_url: null,
  admin_note: null, reject_reason: null, idempotency_key: 'k-x-000000', platform: 'android', is_test: false,
  created_at: '2026-09-10T00:00:00Z', decided_at: null, decided_by: null,
  ...over,
});

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rewardsMarketService.getMarket', () => {
  it('açık ülke kullanıcısı yalnız kendi ülkesinin aktif, silinmemiş ürünlerini sıralı görür', async () => {
    const { rewardsMarketService } = await setup({ users: [user()] });
    const market = await rewardsMarketService.getMarket('u1', 'android');

    expect(market.items.map((i) => i.id)).toEqual(['i-grab', 'i-lineman']);
    expect(market.balance).toBe(200);
    expect(market.monthly_cap).toBe(150);
  });

  it('ürün yanıtı iç alanları sızdırmaz (cost_usd, is_active, sort_order yok)', async () => {
    const { rewardsMarketService } = await setup({ users: [user()] });
    const [grab] = (await rewardsMarketService.getMarket('u1', 'android')).items;

    expect(grab).toEqual({
      id: 'i-grab', brand_key: 'GRAB', country_code: 'TH', currency: 'THB',
      face_value: 50, rainbow_price: 51, logo_url: 'https://cdn.example/grab.png',
    });
  });

  it('bu ayki kullanım PENDING + FULFILLED toplamıdır; REJECTED ve geçen ay sayılmaz', async () => {
    const { rewardsMarketService } = await setup({
      users: [user()],
      reward_redemptions: [
        redemption({ id: 'r1', status: 'PENDING', rainbow_price: 51, created_at: '2026-09-05T00:00:00Z', idempotency_key: 'k1-000000' }),
        redemption({ id: 'r2', status: 'FULFILLED', rainbow_price: 22, created_at: '2026-09-20T00:00:00Z', idempotency_key: 'k2-000000' }),
        redemption({ id: 'r3', status: 'REJECTED', rainbow_price: 101, created_at: '2026-09-21T00:00:00Z', idempotency_key: 'k3-000000' }),
        redemption({ id: 'r4', status: 'FULFILLED', rainbow_price: 101, created_at: '2026-08-31T23:59:59Z', idempotency_key: 'k4-000000' }),
        redemption({ id: 'r5', user_id: 'u2', status: 'PENDING', rainbow_price: 51, idempotency_key: 'k5-000000' }),
      ],
    });

    expect((await rewardsMarketService.getMarket('u1', 'android')).used_this_month).toBe(73);
  });

  it('test admin (ülkesi TR, iOS) tüm ülkelerin aktif ürünlerini görür, tavan uygulanmaz', async () => {
    const { rewardsMarketService } = await setup({
      users: [user({ country: 'TR', is_test_admin: true })],
    });
    const market = await rewardsMarketService.getMarket('u1', 'ios');

    expect(market.items.map((i) => i.id)).toEqual(['i-dana', 'i-grab', 'i-lineman']);
    expect(market.monthly_cap).toBeNull();
  });

  it.each([
    ['market dışı ülke (TR)', { country: 'TR' }, 'android'],
    ['açık ülke ama kapalı platform (TH iOS)', {}, 'ios'],
    ['kapalı ülke (ID)', { country: 'ID' }, 'android'],
    ['seed profil', { is_seed_profile: true }, 'android'],
  ] as const)('%s → RAINBOW_NOT_AVAILABLE (katalog bile dönmez)', async (_name, over, platform) => {
    const { rewardsMarketService } = await setup({ users: [user(over)] });
    await expect(rewardsMarketService.getMarket('u1', platform)).rejects.toMatchObject({
      code: 'RAINBOW_NOT_AVAILABLE', statusCode: 403,
    });
  });

  it('kullanıcı yoksa USER_NOT_FOUND', async () => {
    const { rewardsMarketService } = await setup({ users: [] });
    await expect(rewardsMarketService.getMarket('yok', 'android')).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('katalog okunamazsa SERVER_ERROR (boş market gösterilmez)', async () => {
    const { rewardsMarketService } = await setup(
      { users: [user()] },
      { failOn: [{ table: 'reward_catalog_items', op: 'select' }] },
    );
    await expect(rewardsMarketService.getMarket('u1', 'android')).rejects.toMatchObject({ code: 'SERVER_ERROR' });
  });

  it('katalog önbellekten: art arda iki market açılışı kataloğu bir kez okur', async () => {
    const { fake, rewardsMarketService } = await setup({ users: [user()] });
    await rewardsMarketService.getMarket('u1', 'android');
    await rewardsMarketService.getMarket('u1', 'android');
    expect(fake.queries.filter((q) => q.table === 'reward_catalog_items').length).toBe(1);
  });
});

/** Ana anahtar kapalı (2.0.14'te gömülü): market yalnız iç test hesaplarına; test admin tek başına giremez. */
describe('rewardsMarketService.getMarket — ana anahtar kapalı', () => {
  const closed = { economy_config_versions: [rainbowSwitchRow(false)] };

  it.each([
    ['test admin (test hesabı değil), TR iOS', { country: 'TR', is_test_admin: true }, 'ios'],
    ['test admin açık ülke + açık platform', { is_test_admin: true }, 'android'],
    ['normal kullanıcı açık ülke + açık platform', {}, 'android'],
  ] as const)('%s → RAINBOW_NOT_AVAILABLE, önizleme ülkeleri de dönmez', async (_name, over, platform) => {
    const { rewardsMarketService } = await setup({ ...closed, users: [user(over)] });
    await expect(rewardsMarketService.getMarket('u1', platform, { previewCountry: 'TH' })).rejects.toMatchObject({
      code: 'RAINBOW_NOT_AVAILABLE', statusCode: 403,
    });
  });

  it('test hesabı + test admin: iç test sürer (tüm ülkeler, tavansız, önizleme ülkeleri)', async () => {
    const { rewardsMarketService } = await setup({
      ...closed, users: [user({ country: 'TR', is_test_admin: true, is_test_account: true })],
    });
    const market = await rewardsMarketService.getMarket('u1', 'ios');
    expect(market.items.map((i) => i.id)).toEqual(['i-dana', 'i-grab', 'i-lineman']);
    expect(market.monthly_cap).toBeNull();
    expect(market.preview_countries).toEqual(['TH', 'ID', 'MY']);
  });

  it('test hesabı (admin değil): kendi ülkesinin ürünleri, tavan uygulanır, önizleme yok', async () => {
    const { rewardsMarketService } = await setup({ ...closed, users: [user({ is_test_account: true })] });
    const market = await rewardsMarketService.getMarket('u1', 'ios');
    expect(market.items.map((i) => i.id)).toEqual(['i-grab', 'i-lineman']);
    expect(market.monthly_cap).toBe(150);
    expect(market.preview_countries).toEqual([]);
  });
});

describe('rewardsMarketService.listMyRedemptions', () => {
  it('yalnız kendi talepleri, en yeni önce, sayfalı; iç alanlar yok', async () => {
    const { rewardsMarketService } = await setup({
      users: [user()],
      reward_redemptions: [
        redemption({ id: 'r-old', created_at: '2026-09-01T00:00:00Z', idempotency_key: 'k1-000000' }),
        redemption({ id: 'r-new', status: 'FULFILLED', delivery_code: 'GRAB-1234-5678', created_at: '2026-09-20T00:00:00Z', idempotency_key: 'k2-000000' }),
        redemption({ id: 'r-other', user_id: 'u2', idempotency_key: 'k3-000000' }),
      ],
    });

    const page1 = await rewardsMarketService.listMyRedemptions('u1', 1, 1);
    expect(page1.total).toBe(2);
    expect(page1.items.map((r) => r.id)).toEqual(['r-new']);
    expect(page1.items[0]).toMatchObject({ status: 'FULFILLED', delivery_code: 'GRAB-1234-5678' });
    expect(page1.items[0]).not.toHaveProperty('admin_note');
    expect(page1.items[0]).not.toHaveProperty('idempotency_key');
    expect(page1.items[0]).not.toHaveProperty('user_id');

    const page2 = await rewardsMarketService.listMyRedemptions('u1', 2, 1);
    expect(page2.items.map((r) => r.id)).toEqual(['r-old']);
  });

  it('erişim sonradan kapansa da geçmiş talepler görünür (ödenmiş kod kullanıcının malı)', async () => {
    const { rewardsMarketService } = await setup({
      users: [user({ country: 'TR' })],
      reward_redemptions: [redemption({ id: 'r1', status: 'FULFILLED', delivery_code: 'X' })],
    });
    const result = await rewardsMarketService.listMyRedemptions('u1', 1, 20);
    expect(result.items.map((r) => r.id)).toEqual(['r1']);
  });
});
