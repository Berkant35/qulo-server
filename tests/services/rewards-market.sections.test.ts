import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';

const NOW = new Date('2026-09-28T12:00:00Z');

const section = (over: Record<string, unknown>) => ({
  page_key: 'rewards_market', section_type: 'banner_carousel', heading: { en: 'Deals', th: 'ดีล' }, sort_order: 0,
  status: 'published', countries: null, platforms: null, locales: null, autoplay_seconds: 5, deleted_at: null, ...over,
});
const banner = (over: Record<string, unknown>) => ({
  sort_order: 0, is_active: true, countries: null, platforms: null, locales: null,
  image_url: 'https://cdn.example/x.jpg', content: { en: { title: 'Grab' }, th: { title: 'แกร็บ' } },
  action_type: 'catalog_item', action_catalog_item_id: 'i-grab', action_route: null, catalog_item_id: null, ...over,
});

async function setup(seed: Tables, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase(
    {
      economy_config_versions: [activeConfigRow()],
      reward_market_countries: [
        { country_code: 'TH', currency: 'THB', enabled: true, android_enabled: true, ios_enabled: false },
        { country_code: 'ID', currency: 'IDR', enabled: false, android_enabled: true, ios_enabled: false },
      ],
      reward_catalog_items: [
        { id: 'i-grab', brand_key: 'GRAB', country_code: 'TH', currency: 'THB', face_value: 50, cost_usd: 1.51, rainbow_price: 51, is_active: true, sort_order: 1, logo_url: null, deleted_at: null },
        { id: 'i-dana', brand_key: 'DANA', country_code: 'ID', currency: 'IDR', face_value: 10000, cost_usd: 0.6, rainbow_price: 20, is_active: true, sort_order: 0, logo_url: null, deleted_at: null },
      ],
      reward_redemptions: [],
      page_sections: [
        section({ id: 's-th', countries: ['TH'] }),
        section({ id: 's-draft', status: 'draft', sort_order: 1 }),
        section({ id: 's-id', countries: ['ID'], sort_order: 2 }),
      ],
      page_section_items: [
        banner({ id: 'b-th', section_id: 's-th' }),
        banner({ id: 'b-draft', section_id: 's-draft', action_type: 'none', action_catalog_item_id: null }),
        banner({ id: 'b-id-dana', section_id: 's-id', action_catalog_item_id: 'i-dana' }),
      ],
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
  purple_paid: 0, rainbow_diamonds: 200, is_test_admin: false, is_seed_profile: false, is_test_account: false, ...over,
});

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('rewardsMarketService.getMarket — sections', () => {
  it('normal kullanıcı: yalnız yayındaki + kendi ülkesine hedefli bölüm, metin kendi dilinde, ürün çözülmüş', async () => {
    const { rewardsMarketService } = await setup({ users: [user()] });
    const market = await rewardsMarketService.getMarket('u1', 'android', { locale: 'th' });

    expect(market.sections).toEqual([{
      id: 's-th', type: 'banner_carousel', heading: 'ดีล', is_draft: false, autoplay_seconds: 5,
      items: [{
        id: 'b-th', image_url: 'https://cdn.example/x.jpg', title: 'แกร็บ', subtitle: null, cta_label: null,
        action: { type: 'catalog_item', catalog_item: market.items[0] },
      }],
    }]);
  });

  it('normal kullanıcıda önizleme ülkesi yok sayılır', async () => {
    const { rewardsMarketService } = await setup({ users: [user()] });
    const market = await rewardsMarketService.getMarket('u1', 'android', { previewCountry: 'ID' });
    expect(market.items.map((i) => i.id)).toEqual(['i-grab']);
    expect(market.sections.map((s) => s.id)).toEqual(['s-th']);
  });

  it('test admin önizlemesiz ("Tümü"): tüm ülkelerin ürünleri + taslak is_draft ile + her ülkenin bölümü', async () => {
    const { rewardsMarketService } = await setup({ users: [user({ is_test_admin: true })] });
    const market = await rewardsMarketService.getMarket('u1', 'android');
    expect(market.items.map((i) => i.id)).toEqual(['i-dana', 'i-grab']);
    expect(market.sections.map((s) => [s.id, s.is_draft])).toEqual([['s-th', false], ['s-draft', true], ['s-id', false]]);
  });

  it('test admin önizleme ID: katalog + bölümler ID\'ye süzülür, TH ürününe giden kart düşer', async () => {
    const { rewardsMarketService } = await setup({ users: [user({ is_test_admin: true })] });
    const market = await rewardsMarketService.getMarket('u1', 'android', { previewCountry: 'ID' });
    expect(market.items.map((i) => i.id)).toEqual(['i-dana']);
    expect(market.sections.map((s) => s.id)).toEqual(['s-draft', 's-id']);
  });

  it('bölümler okunamazsa market bölümsüz sunulur (çekirdek akış kırılmaz)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rewardsMarketService } = await setup(
      { users: [user()] },
      { failOn: [{ table: 'page_sections', op: 'select' }] },
    );
    const market = await rewardsMarketService.getMarket('u1', 'android');
    expect(market.items).toHaveLength(1);
    expect(market.sections).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('önizleme ülkeleri: normal kullanıcıda boş', async () => {
    const { rewardsMarketService } = await setup({ users: [user()] });
    const market = await rewardsMarketService.getMarket('u1', 'android');
    expect(market.preview_countries).toEqual([]);
  });

  it('önizleme ülkeleri: test admin\'de market ülkeleri (seçili önizlemeden bağımsız)', async () => {
    const { rewardsMarketService } = await setup({ users: [user({ is_test_admin: true })] });
    expect((await rewardsMarketService.getMarket('u1', 'android')).preview_countries).toEqual(['TH', 'ID', 'MY']);
    expect((await rewardsMarketService.getMarket('u1', 'android', { previewCountry: 'ID' })).preview_countries)
      .toEqual(['TH', 'ID', 'MY']);
  });

  it('yük bütçesi: önbellek sıcakken market açılışı yalnız kullanıcı satırı + bu ay kullanımı okur', async () => {
    const { fake, rewardsMarketService } = await setup({ users: [user()] });
    await rewardsMarketService.getMarket('u1', 'android');
    const before = fake.queries.length;

    await rewardsMarketService.getMarket('u1', 'android');

    expect(fake.queries.slice(before)).toEqual([
      { table: 'users', op: 'select' },
      { table: 'reward_redemptions', op: 'select' },
    ]);
  });
});
