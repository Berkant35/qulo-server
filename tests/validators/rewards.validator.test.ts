import { describe, it, expect } from 'vitest';
import {
  redeemSchema,
  redemptionsQuerySchema,
  countrySwitchSchema,
  catalogItemSchema,
  fulfillSchema,
  rejectSchema,
  adminRedemptionsQuerySchema,
  adminCatalogQuerySchema,
  adminIdParamSchema,
} from '../../src/validators/rewards.validator.js';

const UUID = '3f1c9a52-7d7e-4b8e-9d6a-1b2c3d4e5f60';

describe('redeemSchema (mobil)', () => {
  it('uuid ürün + uuid idempotency anahtarı geçer', () => {
    expect(redeemSchema.safeParse({ item_id: UUID, idempotency_key: UUID }).success).toBe(true);
  });

  it.each([
    [{ item_id: 'x', idempotency_key: UUID }],
    [{ item_id: UUID }],
    [{ item_id: UUID, idempotency_key: 'kisa-anahtar' }],
  ])('geçersiz gövde reddedilir: %j', (body) => {
    expect(redeemSchema.safeParse(body).success).toBe(false);
  });
});

describe('redemptionsQuerySchema (mobil)', () => {
  it('varsayılan 1 / 20; sorgu dizesi sayıya çevrilir', () => {
    expect(redemptionsQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(redemptionsQuerySchema.parse({ page: '2', limit: '10' })).toEqual({ page: 2, limit: 10 });
  });

  it('limit 50 üstü reddedilir', () => {
    expect(redemptionsQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
  });
});

describe('countrySwitchSchema (backoffice)', () => {
  it('işaretli kutu "on" gelir, işaretsiz kutu hiç gelmez → false', () => {
    expect(countrySwitchSchema.parse({ enabled: 'on', ios_enabled: 'on' })).toEqual({
      enabled: true,
      android_enabled: false,
      ios_enabled: true,
    });
  });
});

describe('catalogItemSchema (backoffice)', () => {
  const valid = {
    brand_key: 'GRAB', country_code: 'TH', face_value: '50', cost_usd: '1.51',
    rainbow_price: '51', sort_order: '', logo_url: '', is_active: 'on',
  };

  it('form gövdesi tiplenir; boş opsiyonel alanlar yok sayılır, sıra varsayılan 0', () => {
    expect(catalogItemSchema.parse(valid)).toEqual({
      brand_key: 'GRAB', country_code: 'TH', face_value: 50, cost_usd: 1.51,
      rainbow_price: 51, sort_order: 0, is_active: true,
    });
  });

  it.each([
    ['bilinmeyen marka', { brand_key: 'UBER' }],
    ['küçük harf ülke', { country_code: 'th' }],
    ['sıfır kupür', { face_value: '0' }],
    ['boş kupür', { face_value: '' }],
    ['kesirli rainbow fiyatı', { rainbow_price: '10.5' }],
    ['http logo', { logo_url: 'http://x.com/a.png' }],
  ])('%s reddedilir', (_name, patch) => {
    expect(catalogItemSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('fulfillSchema / rejectSchema (backoffice)', () => {
  it('teslim kodu ya da link zorunlu; boşluklar kırpılır', () => {
    expect(fulfillSchema.safeParse({ delivery_code: '  ', delivery_url: '' }).success).toBe(false);
    expect(fulfillSchema.parse({ delivery_code: ' ABC-123 ' })).toMatchObject({ delivery_code: 'ABC-123' });
    expect(fulfillSchema.parse({ delivery_url: 'https://gift.example/x' })).toMatchObject({
      delivery_url: 'https://gift.example/x',
    });
  });

  it('http teslim linki reddedilir', () => {
    expect(fulfillSchema.safeParse({ delivery_url: 'http://gift.example/x' }).success).toBe(false);
  });

  it('boş ret sebebi reddedilir', () => {
    expect(rejectSchema.safeParse({ reject_reason: '   ' }).success).toBe(false);
    expect(rejectSchema.parse({ reject_reason: ' stok yok ' })).toEqual({ reject_reason: 'stok yok' });
  });
});

describe('admin sorgu şemaları', () => {
  it('bozuk filtre varsayılana düşer (sayfa patlamaz)', () => {
    expect(adminRedemptionsQuerySchema.parse({ status: 'X', page: 'abc', country: 'th' })).toEqual({
      status: 'PENDING',
      page: 1,
    });
    expect(adminCatalogQuerySchema.parse({ brand: 'UBER', status: '?' })).toEqual({ status: 'all', page: 1 });
  });

  it('geçerli filtre korunur', () => {
    expect(adminRedemptionsQuerySchema.parse({ status: 'ALL', q: ' ali@x.com ', country: 'TH', page: '3' })).toEqual({
      status: 'ALL', q: 'ali@x.com', country: 'TH', page: 3,
    });
    expect(adminCatalogQuerySchema.parse({ brand: 'DANA', country: 'ID', status: 'inactive', page: '2' })).toEqual({
      brand: 'DANA', country: 'ID', status: 'inactive', page: 2,
    });
  });

  it('kullanıcı filtresi yalnız uuid: bozuk/boş değer düşer (sayfa patlamaz), geçerli uuid korunur', () => {
    expect(adminRedemptionsQuerySchema.parse({ status: 'ALL', user: UUID })).toMatchObject({ user: UUID });
    expect(adminRedemptionsQuerySchema.parse({ status: 'ALL', user: "x' or 1=1" }).user).toBeUndefined();
    expect(adminRedemptionsQuerySchema.parse({ status: 'ALL', user: '' }).user).toBeUndefined();
  });

  it('admin :id parametresi uuid olmalı', () => {
    expect(adminIdParamSchema.safeParse(UUID).success).toBe(true);
    expect(adminIdParamSchema.safeParse('r1').success).toBe(false);
    expect(adminIdParamSchema.safeParse(undefined).success).toBe(false);
  });
});
