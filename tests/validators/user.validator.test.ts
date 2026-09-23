import { describe, it, expect } from 'vitest';
import { updateProfileSchema, updateLocationSchema } from '../../src/validators/user.validator.js';
import { SUPPORTED_LOCALES } from '../../src/constants/locales.js';

// Dil tercihi: mobil 16 uygulama dilini sunuyor; validator hepsini kabul etmeli
// ("tumunu sec" ile 16 dil birden gelir).
describe('updateProfileSchema preferred_languages', () => {
  it('16 desteklenen dilin tamamini kabul eder', () => {
    const result = updateProfileSchema.safeParse({ preferred_languages: [...SUPPORTED_LOCALES] });
    expect(result.success).toBe(true);
  });

  it('tek bir dil (pt) kabul edilir', () => {
    expect(updateProfileSchema.safeParse({ preferred_languages: ['pt'] }).success).toBe(true);
  });

  it('desteklenmeyen dil reddedilir', () => {
    expect(updateProfileSchema.safeParse({ preferred_languages: ['xx'] }).success).toBe(false);
  });

  it('bos liste reddedilir', () => {
    expect(updateProfileSchema.safeParse({ preferred_languages: [] }).success).toBe(false);
  });
});

// Konum güncellemesinde ülke ISO 3166-1 alpha-2 (mobil Placemark.isoCountryCode):
// FormatManager ve bölge bazlı kampanya raporları bu biçimi bekler; tam ad / küçük harf reddedilir.
describe('updateLocationSchema country', () => {
  const base = { lat: 41.0, lng: 29.0 };

  it('ISO-2 büyük harf kabul edilir', () => {
    expect(updateLocationSchema.safeParse({ ...base, country: 'TR' }).success).toBe(true);
  });

  it('ülke verilmeden de geçerli — eski istemciler (2.0.11 ve öncesi) göndermiyor', () => {
    expect(updateLocationSchema.safeParse(base).success).toBe(true);
  });

  for (const bad of ['Türkiye', 'tr', 'TUR', '']) {
    it(`"${bad}" reddedilir`, () => {
      expect(updateLocationSchema.safeParse({ ...base, country: bad }).success).toBe(false);
    });
  }

  it('updateProfileSchema.country aynı kuralı kullanır — sütuna yazan iki yol tek biçim', () => {
    expect(updateProfileSchema.safeParse({ country: 'TR' }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ country: 'Türkiye' }).success).toBe(false);
  });
});
