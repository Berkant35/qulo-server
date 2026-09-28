import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabase, type FakeSupabaseOptions, type Tables } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';
import { REWARD_REDEEM_REASON, REWARD_REFUND_REASON } from '../../src/utils/rewards.js';

const NOW = new Date('2026-09-28T12:00:00Z');
const KEY = '11111111-1111-4111-8111-111111111111';
const KEY2 = '22222222-2222-4222-8222-222222222222';

const section = (over: Record<string, unknown>) => ({
  page_key: 'rewards_market', section_type: 'banner_carousel', heading: null, sort_order: 0, status: 'published',
  countries: null, platforms: null, locales: null, autoplay_seconds: 5, deleted_at: null, ...over,
});
const banner = (over: Record<string, unknown>) => ({
  sort_order: 0, is_active: true, countries: null, platforms: null, locales: null,
  image_url: 'https://cdn.example/x.jpg', content: { en: { title: 'Grab' } },
  action_type: 'catalog_item', action_catalog_item_id: 'i-grab', action_route: null, catalog_item_id: null, ...over,
});

async function setup(seed: Tables, options: FakeSupabaseOptions = {}) {
  const fake = createFakeSupabase(
    {
      economy_config_versions: [activeConfigRow()],
      reward_market_countries: [
        { country_code: 'TH', currency: 'THB', enabled: true, android_enabled: true, ios_enabled: false },
      ],
      reward_catalog_items: [
        { id: 'i-grab', brand_key: 'GRAB', country_code: 'TH', currency: 'THB', face_value: 50, cost_usd: 1.51, rainbow_price: 51, is_active: true, sort_order: 1, logo_url: null, deleted_at: null },
      ],
      reward_redemptions: [],
      diamond_transactions: [],
      page_sections: [
        section({ id: 's-live' }),
        section({ id: 's-draft', status: 'draft', sort_order: 1 }),
        section({ id: 's-ios', platforms: ['ios'], sort_order: 2 }),
      ],
      page_section_items: [
        banner({ id: 'b-live', section_id: 's-live' }),
        banner({ id: 'b-draft', section_id: 's-draft' }),
        banner({ id: 'b-ios', section_id: 's-ios' }),
      ],
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
  has_reward_redemptions: false, ...over,
});

const input = (over: Record<string, unknown> = {}) => ({ itemId: 'i-grab', idempotencyKey: KEY, ...over });

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('redeem — source_item_id', () => {
  it('görünür kart kaynak olarak yazılır', async () => {
    const { fake, rewardsMarketService } = await setup({ users: [user()] });
    await rewardsMarketService.redeem('u1', input({ sourceItemId: 'b-live' }), 'android', 'en');
    expect(fake.table('reward_redemptions')[0].source_item_id).toBe('b-live');
  });

  it('taslak, başka platforma hedefli ya da bilinmeyen kart → NULL (itfa yine başarılı)', async () => {
    const { fake, rewardsMarketService } = await setup({ users: [user({ rainbow_diamonds: 500 })] });
    await rewardsMarketService.redeem('u1', input({ sourceItemId: 'b-draft' }), 'android');
    await rewardsMarketService.redeem('u1', input({ idempotencyKey: KEY2, sourceItemId: 'b-ios' }), 'android');
    const rows = fake.table('reward_redemptions');
    expect(rows.map((r) => r.source_item_id)).toEqual([null, null]);
    expect(rows.map((r) => r.status)).toEqual(['PENDING', 'PENDING']);
  });

  it('kaynak verilmezse NULL', async () => {
    const { fake, rewardsMarketService } = await setup({ users: [user()] });
    await rewardsMarketService.redeem('u1', input(), 'android');
    expect(fake.table('reward_redemptions')[0].source_item_id).toBeNull();
  });

  it('test admin taslak kartı görür → kaynak yazılır', async () => {
    const { fake, rewardsMarketService } = await setup({ users: [user({ is_test_admin: true })] });
    await rewardsMarketService.redeem('u1', input({ sourceItemId: 'b-draft' }), 'android');
    expect(fake.table('reward_redemptions')[0].source_item_id).toBe('b-draft');
  });

  it('bölümler okunamazsa kaynak NULL, itfa başarılı', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fake, rewardsMarketService } = await setup(
      { users: [user()] },
      { failOn: [{ table: 'page_sections', op: 'select' }] },
    );
    const result = await rewardsMarketService.redeem('u1', input({ sourceItemId: 'b-live' }), 'android');
    expect(result.redemption.status).toBe('PENDING');
    expect(fake.table('reward_redemptions')[0].source_item_id).toBeNull();
  });
});

describe('redeem — has_reward_redemptions', () => {
  it('ilk başarılı itfada true; sonraki itfa bayrağı tekrar yazmaz', async () => {
    const { fake, rewardsMarketService } = await setup({ users: [user()] });
    const usersUpdates = () => fake.queries.filter((q) => q.table === 'users' && q.op === 'update').length;

    await rewardsMarketService.redeem('u1', input(), 'android');
    expect(fake.table('users')[0].has_reward_redemptions).toBe(true);
    const afterFirst = usersUpdates(); // rainbow düşümü + bayrak

    await rewardsMarketService.redeem('u1', input({ idempotencyKey: KEY2 }), 'android');
    expect(usersUpdates() - afterFirst).toBe(1); // yalnız rainbow düşümü
  });

  it('bayrak yazılamazsa itfa yine başarılı ve iz bırakılır', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rewardsMarketService } = await setup(
      { users: [user()] },
      // 1. users.update = rainbow düşümü (başarılı); 2. = bayrak (patlar).
      { failOn: [{ table: 'users', op: 'update', failAfter: 1 }] },
    );
    const result = await rewardsMarketService.redeem('u1', input(), 'android');
    expect(result.redemption.status).toBe('PENDING');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('has_reward_redemptions'), expect.anything());
  });

  it('başarısız itfa (yetersiz bakiye) bayrağı açmaz', async () => {
    const { fake, rewardsMarketService } = await setup({ users: [user({ rainbow_diamonds: 10 })] });
    await expect(rewardsMarketService.redeem('u1', input(), 'android')).rejects.toMatchObject({ code: 'INSUFFICIENT_DIAMONDS' });
    expect(fake.table('users')[0].has_reward_redemptions).toBe(false);
  });
});

describe('redeem — ölçüm itfayı düşürmez', () => {
  it('görünürlük adımında katalog okunamazsa kaynak NULL, itfa başarılı, uyarı loglanır', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fake, rewardsMarketService } = await setup({ users: [user()] });
    const { rewardsCatalogCache } = await import('../../src/services/rewards-catalog-cache.js');
    const { Errors } = await import('../../src/utils/errors.js');
    // İtfada `listForCountry`'yi YALNIZ görünürlük adımı çağırır (ürün okuması `getActive`): reddetmek tam o
    // adımı hedefler — önbellek süresine ve sorgu sırasına bağlı kalmadan "katalog o an okunamadı" durumu.
    const listSpy = vi.spyOn(rewardsCatalogCache, 'listForCountry').mockRejectedValue(Errors.SERVER_ERROR());

    const result = await rewardsMarketService.redeem('u1', input({ sourceItemId: 'b-live' }), 'android');

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(result.redemption.status).toBe('PENDING');
    expect(fake.table('reward_redemptions')[0].source_item_id).toBeNull();
    expect(fake.table('users')[0].rainbow_diamonds).toBe(149);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('kaynak kart'),
      expect.objectContaining({ userId: 'u1', sourceItemId: 'b-live' }),
    );
  });
});

describe('redeem — kaynak kart FK yarışı (23503)', () => {
  const FK = {
    message: 'insert or update on table "reward_redemptions" violates foreign key constraint "reward_redemptions_source_item_id_fkey"',
    code: '23503',
  };
  const inserts = (fake: FakeSupabase) =>
    fake.queries.filter((q) => q.table === 'reward_redemptions' && q.op === 'insert').length;
  const reasons = (fake: FakeSupabase) => fake.table('diamond_transactions').map((t) => t.reason);

  it('kart okuma ile yazım arasında silinirse: talep kaynaksız yazılır, rainbow bir kez düşer, iade yok', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fake, rewardsMarketService } = await setup(
      { users: [user()] },
      { failOn: [{ table: 'reward_redemptions', op: 'insert', times: 1, error: FK }] },
    );

    const result = await rewardsMarketService.redeem('u1', input({ sourceItemId: 'b-live' }), 'android');

    expect(result).toMatchObject({ balance: 149, redemption: { status: 'PENDING' } });
    expect(inserts(fake)).toBe(2);
    const rows = fake.table('reward_redemptions');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: result.redemption.id, idempotency_key: KEY, source_item_id: null });
    expect(fake.table('users')[0]).toMatchObject({ rainbow_diamonds: 149, has_reward_redemptions: true });
    expect(reasons(fake)).toEqual([REWARD_REDEEM_REASON]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('23503'), expect.objectContaining({ sourceItemId: 'b-live' }));
  });

  it('kaynaksız tekrar da patlarsa: yalnız BİR tekrar, sonra mevcut iade yolu (iade + SERVER_ERROR)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fake, rewardsMarketService } = await setup(
      { users: [user()] },
      { failOn: [{ table: 'reward_redemptions', op: 'insert', error: FK }] },
    );

    await expect(rewardsMarketService.redeem('u1', input({ sourceItemId: 'b-live' }), 'android'))
      .rejects.toMatchObject({ code: 'SERVER_ERROR' });

    expect(inserts(fake)).toBe(2);
    expect(fake.table('reward_redemptions')).toHaveLength(0);
    expect(fake.table('users')[0].rainbow_diamonds).toBe(200);
    expect(reasons(fake)).toEqual([REWARD_REDEEM_REASON, REWARD_REFUND_REASON]);
  });

  it('23503 ama kaynak zaten NULL: tekrar yok, mevcut iade yolu değişmez', async () => {
    const { fake, rewardsMarketService } = await setup(
      { users: [user()] },
      { failOn: [{ table: 'reward_redemptions', op: 'insert', error: FK }] },
    );

    await expect(rewardsMarketService.redeem('u1', input(), 'android')).rejects.toMatchObject({ code: 'SERVER_ERROR' });

    expect(inserts(fake)).toBe(1);
    expect(fake.table('users')[0].rainbow_diamonds).toBe(200);
    expect(reasons(fake)).toEqual([REWARD_REDEEM_REASON, REWARD_REFUND_REASON]);
  });

  it('23503 dışı hata (kaynak dolu): tekrar yok, mevcut iade yolu değişmez', async () => {
    const { fake, rewardsMarketService } = await setup(
      { users: [user()] },
      { failOn: [{ table: 'reward_redemptions', op: 'insert', error: { message: 'canceling statement due to statement timeout', code: '57014' } }] },
    );

    await expect(rewardsMarketService.redeem('u1', input({ sourceItemId: 'b-live' }), 'android'))
      .rejects.toMatchObject({ code: 'SERVER_ERROR' });

    expect(inserts(fake)).toBe(1);
    expect(fake.table('reward_redemptions')).toHaveLength(0);
    expect(fake.table('users')[0].rainbow_diamonds).toBe(200);
    expect(reasons(fake)).toEqual([REWARD_REDEEM_REASON, REWARD_REFUND_REASON]);
  });
});
