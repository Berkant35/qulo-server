import { describe, it, expect } from 'vitest';
import { economyConfigSchema, DEFAULT_RAINBOW } from '../../src/types/economy-config.schema.js';
import { economyConfigFixture, configWithoutRainbow } from '../helpers/economy-config.fixture.js';

describe('economy config — rainbow bloğu', () => {
  it('eski config versiyonunda blok yoksa varsayılanlar uygulanır', () => {
    const parsed = economyConfigSchema.parse(configWithoutRainbow());
    expect(parsed.rainbow).toEqual(DEFAULT_RAINBOW);
    expect(parsed.rainbow.subscriptionPaidShare).toEqual({ free: 0, plus: 0.3, premium: 0.2 });
  });

  it('verilen değerler korunur', () => {
    const parsed = economyConfigSchema.parse({
      ...economyConfigFixture,
      rainbow: { ...DEFAULT_RAINBOW, monthlyRedeemCap: 300, subscriptionPaidShare: { free: 0, plus: 0.1, premium: 0.1 } },
    });
    expect(parsed.rainbow.monthlyRedeemCap).toBe(300);
    expect(parsed.rainbow.subscriptionPaidShare.plus).toBe(0.1);
  });

  // Ana anahtar (kullanıcı kararı 2026-09-30): anahtar yoksa Rainbow KAPALI — migration'sız, eski
  // config sürümleri (prod v4'te blok hiç yok) kendiliğinden kapalı kalır.
  it('ana anahtar: blok yoksa kapalı', () => {
    expect(economyConfigSchema.parse(configWithoutRainbow()).rainbow.enabled).toBe(false);
  });

  it('ana anahtar: blok var ama `enabled` yoksa kapalı', () => {
    const { enabled: _omit, ...withoutSwitch } = economyConfigFixture.rainbow;
    const parsed = economyConfigSchema.parse({ ...economyConfigFixture, rainbow: withoutSwitch });
    expect(parsed.rainbow.enabled).toBe(false);
    expect(parsed.rainbow.monthlyRedeemCap).toBe(150);
  });

  it('ana anahtar: açık değer korunur (zod ayıklamaz)', () => {
    const parsed = economyConfigSchema.parse({ ...economyConfigFixture, rainbow: { ...DEFAULT_RAINBOW, enabled: true } });
    expect(parsed.rainbow.enabled).toBe(true);
  });

  it('ana anahtar: boolean olmayan değer reddedilir ("true" metni açmaz)', () => {
    const result = economyConfigSchema.safeParse({ ...economyConfigFixture, rainbow: { ...DEFAULT_RAINBOW, enabled: 'true' } });
    expect(result.success).toBe(false);
  });

  it.each([
    ['ödenmiş pay 0,5 üstü', { subscriptionPaidShare: { free: 0, plus: 0.6, premium: 0.2 } }],
    ['tavan 20 altı', { monthlyRedeemCap: 10 }],
    ['hesap yaşı 90 üstü', { minAccountAgeDays: 120 }],
    ['önerilen kur 0,07 üstü', { suggestedUsdPerRainbow: 0.1 }],
  ])('sınır dışı reddedilir: %s', (_label, patch) => {
    const result = economyConfigSchema.safeParse({
      ...economyConfigFixture,
      rainbow: { ...DEFAULT_RAINBOW, ...patch },
    });
    expect(result.success).toBe(false);
  });
});
