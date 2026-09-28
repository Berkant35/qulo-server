import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';

const NOW = new Date('2026-09-28T12:00:00Z');

const items = () => [
  { id: 'i-lineman', brand_key: 'LINEMAN', country_code: 'TH', currency: 'THB', face_value: 100, cost_usd: 3.03, rainbow_price: 101, is_active: true, sort_order: 2, logo_url: null, deleted_at: null },
  { id: 'i-grab', brand_key: 'GRAB', country_code: 'TH', currency: 'THB', face_value: 50, cost_usd: 1.51, rainbow_price: 51, is_active: true, sort_order: 1, logo_url: null, deleted_at: null },
  { id: 'i-off', brand_key: 'TRUEMONEY', country_code: 'TH', currency: 'THB', face_value: 20, cost_usd: 0.64, rainbow_price: 22, is_active: false, sort_order: 0, logo_url: null, deleted_at: null },
  { id: 'i-gone', brand_key: 'GRAB', country_code: 'TH', currency: 'THB', face_value: 500, cost_usd: 15, rainbow_price: 500, is_active: true, sort_order: 0, logo_url: null, deleted_at: '2026-09-20T00:00:00Z' },
  { id: 'i-dana', brand_key: 'DANA', country_code: 'ID', currency: 'IDR', face_value: 10000, cost_usd: 0.6, rainbow_price: 20, is_active: true, sort_order: 0, logo_url: null, deleted_at: null },
];

async function setup(options?: FakeSupabaseOptions, catalogRows = items()) {
  const fake = createFakeSupabase({
    reward_catalog_items: catalogRows,
    reward_market_countries: [{ country_code: 'TH', currency: 'THB', enabled: true, android_enabled: true, ios_enabled: false }],
  }, options);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { rewardsCatalogCache, CATALOG_CACHE_TTL_MS } = await import('../../src/services/rewards-catalog-cache.js');
  const { rewardsCatalogAdminService } = await import('../../src/services/rewards-catalog-admin.service.js');
  const catalogReads = () => fake.queries.filter((q) => q.table === 'reward_catalog_items' && q.op === 'select').length;
  return { fake, rewardsCatalogCache, rewardsCatalogAdminService, CATALOG_CACHE_TTL_MS, catalogReads };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('rewardsCatalogCache', () => {
  it('ülke süzmesi yalnız aktif + silinmemiş ürünleri DB sırasıyla verir; null = tüm ülkeler', async () => {
    const { rewardsCatalogCache } = await setup();
    expect((await rewardsCatalogCache.listForCountry('TH')).map((i) => i.id)).toEqual(['i-grab', 'i-lineman']);
    expect((await rewardsCatalogCache.listForCountry(null)).map((i) => i.id)).toEqual(['i-dana', 'i-grab', 'i-lineman']);
    expect(await rewardsCatalogCache.getActive('i-off')).toBeNull();
    expect(await rewardsCatalogCache.getActive('i-dana')).toMatchObject({ country_code: 'ID', rainbow_price: 20 });
  });

  it('ürün şekli iç alan taşımaz (cost_usd / is_active / sort_order yok)', async () => {
    const { rewardsCatalogCache } = await setup();
    expect(await rewardsCatalogCache.getActive('i-grab')).toEqual({
      id: 'i-grab', brand_key: 'GRAB', country_code: 'TH', currency: 'THB', face_value: 50, rainbow_price: 51, logo_url: null,
    });
  });

  it('60 sn içinde ikinci okuma DB\'ye gitmez; süre dolunca yeniden okur', async () => {
    const { rewardsCatalogCache, CATALOG_CACHE_TTL_MS, catalogReads } = await setup();
    await rewardsCatalogCache.listForCountry('TH');
    await rewardsCatalogCache.getActive('i-grab');
    expect(catalogReads()).toBe(1);

    vi.setSystemTime(new Date(NOW.getTime() + CATALOG_CACHE_TTL_MS + 1));
    await rewardsCatalogCache.listForCountry('TH');
    expect(catalogReads()).toBe(2);
  });

  it('okuma hatası SERVER_ERROR fırlatır ve önbelleğe yazılmaz (sonraki çağrı yeniden dener)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rewardsCatalogCache, catalogReads } = await setup({
      failOn: [{ table: 'reward_catalog_items', op: 'select', failAfter: 0 }],
    });
    await expect(rewardsCatalogCache.listForCountry('TH')).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    await expect(rewardsCatalogCache.listForCountry('TH')).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(catalogReads()).toBe(2);
  });

  it('okuma sürerken invalidate: eski sonuç önbelleğe yazılmaz', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { rewardsCatalogCache, catalogReads } = await setup({ holdRead: { table: 'reward_catalog_items', until: gate } });

    const inFlight = rewardsCatalogCache.listForCountry('TH');
    rewardsCatalogCache.invalidate();
    release();
    await inFlight;

    await rewardsCatalogCache.listForCountry('TH');
    expect(catalogReads()).toBe(2);
  });

  it('aktif katalog 500 satır sınırına ulaşırsa her yüklemede bir kez uyarı (sınır ötesi ürün listelenmez VE itfa edilemez)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const many = Array.from({ length: 501 }, (_, n) => ({
      id: `i-${String(n).padStart(3, '0')}`, brand_key: 'GRAB', country_code: 'TH', currency: 'THB', face_value: n + 1,
      cost_usd: 1, rainbow_price: 10, is_active: true, sort_order: n, logo_url: null, deleted_at: null,
    }));
    const { rewardsCatalogCache, CATALOG_CACHE_TTL_MS } = await setup(undefined, many);
    const truncationWarnings = () => warnSpy.mock.calls.filter((c) => String(c[0]).includes('500')).length;

    expect(await rewardsCatalogCache.listForCountry('TH')).toHaveLength(500);
    expect(await rewardsCatalogCache.getActive('i-500')).toBeNull();
    expect(truncationWarnings()).toBe(1); // ikinci okuma önbellekten: yükleme yok, uyarı yok

    vi.setSystemTime(new Date(NOW.getTime() + CATALOG_CACHE_TTL_MS + 1));
    await rewardsCatalogCache.listForCountry('TH');
    expect(truncationWarnings()).toBe(2);
  });

  it('sınırın altında uyarı yok', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rewardsCatalogCache } = await setup();
    await rewardsCatalogCache.listForCountry('TH');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('admin katalog yazımı önbelleği bu süreçte hemen düşürür', async () => {
    const { fake, rewardsCatalogCache, rewardsCatalogAdminService } = await setup();
    expect(await rewardsCatalogCache.getActive('i-grab')).not.toBeNull();

    await rewardsCatalogAdminService.setCatalogActive('i-grab', false);
    expect(await rewardsCatalogCache.getActive('i-grab')).toBeNull();

    await rewardsCatalogAdminService.updateCatalogItem('i-lineman', {
      brand_key: 'LINEMAN', country_code: 'TH', face_value: 100, rainbow_price: 120, sort_order: 2, is_active: true,
    });
    expect((await rewardsCatalogCache.getActive('i-lineman'))?.rainbow_price).toBe(120);

    await rewardsCatalogAdminService.softDeleteCatalogItem('i-lineman');
    expect(await rewardsCatalogCache.getActive('i-lineman')).toBeNull();

    const created = await rewardsCatalogAdminService.createCatalogItem({
      brand_key: 'GRAB', country_code: 'TH', face_value: 200, rainbow_price: 201, sort_order: 5, is_active: true,
    });
    expect(await rewardsCatalogCache.getActive(created.id)).not.toBeNull();
    expect(fake.table('reward_catalog_items').length).toBe(6);
  });
});
