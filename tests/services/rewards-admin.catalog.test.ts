import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';
import type { CatalogItemInput } from '../../src/validators/rewards.validator.js';

const countries = () => [
  { country_code: 'TH', currency: 'THB', enabled: false, android_enabled: true, ios_enabled: false, updated_at: null },
  { country_code: 'ID', currency: 'IDR', enabled: false, android_enabled: true, ios_enabled: false, updated_at: null },
  { country_code: 'MY', currency: 'MYR', enabled: false, android_enabled: true, ios_enabled: false, updated_at: null },
];

const item = (over: Record<string, unknown>) => ({
  id: 'i-x', brand_key: 'GRAB', country_code: 'TH', currency: 'THB', face_value: 50, cost_usd: 1.51,
  rainbow_price: 51, is_active: false, sort_order: 0, logo_url: null, created_at: '2026-09-27T00:00:00Z',
  updated_at: null, deleted_at: null,
  ...over,
});

async function setup(seed: Tables = {}, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase({ reward_market_countries: countries(), reward_catalog_items: [], ...seed }, options);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { rewardsAdminService } = await import('../../src/services/rewards-admin.service.js');
  const { rainbowAccessService } = await import('../../src/services/rainbow-access.service.js');
  return { fake, rewardsAdminService, rainbowAccessService };
}

const input = (over: Partial<CatalogItemInput> = {}): CatalogItemInput => ({
  brand_key: 'GRAB', country_code: 'TH', face_value: 50, cost_usd: 1.51, rainbow_price: 51,
  sort_order: 0, logo_url: undefined, is_active: false,
  ...over,
});

beforeEach(() => {
  vi.resetModules();
});

describe('rewardsAdminService — ülkeler', () => {
  it('ülkeler koda göre sıralı', async () => {
    const { rewardsAdminService } = await setup();
    expect((await rewardsAdminService.listCountries()).map((c) => c.country_code)).toEqual(['ID', 'MY', 'TH']);
  });

  it('anahtar güncellenir ve erişim önbelleği HEMEN düşer (60 sn beklemeden)', async () => {
    const { fake, rewardsAdminService, rainbowAccessService } = await setup();
    const thUser = { country: 'TH', is_test_admin: false, is_seed_profile: false, is_test_account: false };

    await expect(rainbowAccessService.isEnabled(thUser, 'android')).resolves.toBe(false); // önbellek dolar
    await rewardsAdminService.updateCountry('TH', { enabled: true, android_enabled: true, ios_enabled: false });

    expect(fake.table('reward_market_countries').find((c) => c.country_code === 'TH')).toMatchObject({
      enabled: true, android_enabled: true, ios_enabled: false,
    });
    await expect(rainbowAccessService.isEnabled(thUser, 'android')).resolves.toBe(true);
  });

  it('bilinmeyen ülke kodu → VALIDATION_ERROR', async () => {
    const { rewardsAdminService } = await setup();
    await expect(
      rewardsAdminService.updateCountry('SG', { enabled: true, android_enabled: true, ios_enabled: true }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('rewardsAdminService — katalog', () => {
  it('para birimi ülkeden gelir (TH → THB); yeni ürün yazılır', async () => {
    const { fake, rewardsAdminService } = await setup();
    const created = await rewardsAdminService.createCatalogItem(input({ country_code: 'MY', face_value: 10, rainbow_price: 82 }));

    expect(created).toMatchObject({ country_code: 'MY', currency: 'MYR', face_value: 10, rainbow_price: 82, cost_usd: 1.51 });
    expect(fake.table('reward_catalog_items')).toHaveLength(1);
  });

  it('bilinmeyen ülkeye ürün eklenmez → VALIDATION_ERROR', async () => {
    const { fake, rewardsAdminService } = await setup();
    await expect(rewardsAdminService.createCatalogItem(input({ country_code: 'SG' }))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(fake.table('reward_catalog_items')).toHaveLength(0);
  });

  it('liste filtreleri: marka, ülke, aktiflik; silinmiş hiç görünmez; sayfa toplamı', async () => {
    const { rewardsAdminService } = await setup({
      reward_catalog_items: [
        item({ id: 'a', brand_key: 'GRAB', country_code: 'TH', is_active: true, sort_order: 1 }),
        item({ id: 'b', brand_key: 'LINEMAN', country_code: 'TH', is_active: false, sort_order: 2 }),
        item({ id: 'c', brand_key: 'DANA', country_code: 'ID', currency: 'IDR', is_active: true }),
        item({ id: 'd', brand_key: 'GRAB', country_code: 'TH', is_active: true, deleted_at: '2026-09-26T00:00:00Z' }),
      ],
    });

    const all = await rewardsAdminService.listCatalog({ status: 'all', page: 1 });
    expect(all.items.map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect(all.total).toBe(3);

    expect((await rewardsAdminService.listCatalog({ status: 'all', brand: 'GRAB', page: 1 })).items.map((i) => i.id)).toEqual(['a']);
    expect((await rewardsAdminService.listCatalog({ status: 'all', country: 'TH', page: 1 })).items.map((i) => i.id)).toEqual(['a', 'b']);
    expect((await rewardsAdminService.listCatalog({ status: 'inactive', page: 1 })).items.map((i) => i.id)).toEqual(['b']);
    expect((await rewardsAdminService.listCatalog({ status: 'active', page: 1 })).items.map((i) => i.id)).toEqual(['c', 'a']);
  });

  it('güncelleme alanları ve para birimini yeniden yazar; silinmiş ürün güncellenemez', async () => {
    const { fake, rewardsAdminService } = await setup({
      reward_catalog_items: [item({ id: 'a' }), item({ id: 'gone', deleted_at: '2026-09-26T00:00:00Z' })],
    });

    await rewardsAdminService.updateCatalogItem('a', input({ country_code: 'ID', face_value: 25000, rainbow_price: 48, is_active: true }));
    expect(fake.table('reward_catalog_items')[0]).toMatchObject({
      country_code: 'ID', currency: 'IDR', face_value: 25000, rainbow_price: 48, is_active: true,
    });
    expect(fake.table('reward_catalog_items')[0].updated_at).toEqual(expect.any(String));

    await expect(rewardsAdminService.updateCatalogItem('gone', input())).rejects.toMatchObject({
      code: 'REWARD_ITEM_UNAVAILABLE',
    });
  });

  it('aktifleştir / pasifleştir durumu doğrudan yazar (okumadan, tekrar güvenli)', async () => {
    const { fake, rewardsAdminService } = await setup({ reward_catalog_items: [item({ id: 'a', is_active: false })] });
    await rewardsAdminService.setCatalogActive('a', true);
    await rewardsAdminService.setCatalogActive('a', true);
    expect(fake.table('reward_catalog_items')[0].is_active).toBe(true);
  });

  it('silme soft: satır kalır (geçmiş talepler FK ile bağlı), pasifleşir, bir daha okunmaz', async () => {
    const { fake, rewardsAdminService } = await setup({ reward_catalog_items: [item({ id: 'a', is_active: true })] });
    await rewardsAdminService.softDeleteCatalogItem('a');

    expect(fake.table('reward_catalog_items')[0]).toMatchObject({ is_active: false, deleted_at: expect.any(String) });
    await expect(rewardsAdminService.getCatalogItem('a')).resolves.toBeNull();
  });
});
