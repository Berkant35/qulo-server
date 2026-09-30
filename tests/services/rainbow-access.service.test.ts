import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';
import { activeConfigRow, configWithoutRainbow, rainbowSwitchRow } from '../helpers/economy-config.fixture.js';

/** Varsayılan: ana anahtar AÇIK (yayındaki kurallar). Kapalı hal için `economy_config_versions` ezilir. */
async function setup(seed: Tables = {}, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase(
    {
      economy_config_versions: [rainbowSwitchRow(true)],
      reward_market_countries: [
        { country_code: 'TH', currency: 'THB', enabled: true, android_enabled: true, ios_enabled: false },
        { country_code: 'ID', currency: 'IDR', enabled: false, android_enabled: true, ios_enabled: true },
        { country_code: 'MY', currency: 'MYR', enabled: true, android_enabled: false, ios_enabled: true },
      ],
      ...seed,
    },
    options,
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { rainbowAccessService } = await import('../../src/services/rainbow-access.service.js');
  return { fake, rainbowAccessService };
}

const base = { country: 'TH', is_test_admin: false, is_seed_profile: false, is_test_account: false };

beforeEach(() => {
  vi.resetModules();
});

describe('rainbowAccessService.isEnabled', () => {
  it.each([
    ['açık ülke + açık platform', base, 'android', true],
    ['açık ülke + kapalı platform (TH iOS)', base, 'ios', false],
    ['kapalı ülke (ID)', { ...base, country: 'ID' }, 'android', false],
    ['açık ülke, android kapalı (MY)', { ...base, country: 'MY' }, 'android', false],
    ['açık ülke, ios açık (MY)', { ...base, country: 'MY' }, 'ios', true],
    ['listede olmayan ülke (TR)', { ...base, country: 'TR' }, 'android', false],
    ['ülke yok', { ...base, country: null }, 'android', false],
    ['platform bilinmiyor', base, undefined, false],
    ['web platformu (market yalnız mobil) açık ülkede bile kapalı', base, 'web', false],
    ['küçük harf ülke kodu', { ...base, country: 'th' }, 'android', true],
    ['seed profil açık ülkede bile kapalı', { ...base, is_seed_profile: true }, 'android', false],
    ['test hesabı kapalı', { ...base, is_test_account: true }, 'android', false],
    ['test admin her yerde açık', { ...base, country: 'TR', is_test_admin: true }, undefined, true],
    ['test admin + test hesabı yine açık', { ...base, is_test_admin: true, is_test_account: true }, 'ios', true],
  ] as const)('%s', async (_label, user, platform, expected) => {
    const { rainbowAccessService } = await setup();
    await expect(rainbowAccessService.isEnabled(user, platform)).resolves.toBe(expected);
  });

  it('ülke tablosu okunamazsa kapalıya düşer (admin hariç)', async () => {
    const { rainbowAccessService } = await setup({}, { failOn: [{ table: 'reward_market_countries', op: 'select' }] });
    await expect(rainbowAccessService.isEnabled(base, 'android')).resolves.toBe(false);
    await expect(rainbowAccessService.isEnabled({ ...base, is_test_admin: true }, 'android')).resolves.toBe(true);
  });

  it('ülke satırları önbelleklenir; invalidate yeniden okutur', async () => {
    const { fake, rainbowAccessService } = await setup();
    await rainbowAccessService.isEnabled(base, 'android');
    await rainbowAccessService.isEnabled(base, 'android');
    const reads = () => fake.queries.filter((q) => q.table === 'reward_market_countries').length;
    expect(reads()).toBe(1);
    rainbowAccessService.invalidate();
    await rainbowAccessService.isEnabled(base, 'android');
    expect(reads()).toBe(2);
  });

  it('önbellek süresi dolduktan sonra okuma patlarsa son başarılı satırlar kullanılır', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-09-27T12:00:00Z'));
      const { rainbowAccessService } = await setup({}, {
        failOn: [{ table: 'reward_market_countries', op: 'select', failAfter: 1 }],
      });
      await expect(rainbowAccessService.isEnabled(base, 'android')).resolves.toBe(true); // 1. okuma başarılı, önbellek dolar
      vi.setSystemTime(new Date('2026-09-27T12:01:01Z')); // TTL (60 sn) doldu
      await expect(rainbowAccessService.isEnabled(base, 'android')).resolves.toBe(true); // 2. okuma patlar → bayat satırlar
      await expect(rainbowAccessService.isEnabled({ ...base, country: 'ID' }, 'android')).resolves.toBe(false); // bayat satırda ID kapalı
    } finally {
      vi.useRealTimers();
    }
  });

  it('okuma hatasında DB her istekte dövülmez: 5 sn geri çekilir, sonra yeniden dener', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-09-27T12:00:00Z'));
      const { fake, rainbowAccessService } = await setup({}, {
        failOn: [{ table: 'reward_market_countries', op: 'select' }],
      });
      const reads = () => fake.queries.filter((q) => q.table === 'reward_market_countries').length;

      await expect(rainbowAccessService.isEnabled(base, 'android')).resolves.toBe(false); // hiç başarılı okuma yok → kapalı
      await rainbowAccessService.isEnabled(base, 'android');
      await rainbowAccessService.isEnabled(base, 'android');
      expect(reads()).toBe(1);

      vi.setSystemTime(new Date('2026-09-27T12:00:05.001Z'));
      await rainbowAccessService.isEnabled(base, 'android');
      expect(reads()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Ana anahtar (kullanıcı kararı 2026-09-30): Rainbow 2.0.14'te gömülü. Kapalıyken yalnız iç test hesapları
 * (`is_test_account`, seed değil) görür; `is_test_admin` TEK BAŞINA açmaz — prod'da test hesabı olmayan
 * 133 kullanıcıda bayrak yanlışlıkla true.
 */
describe('rainbowAccessService.isEnabled — ana anahtar kapalı', () => {
  const closed = { economy_config_versions: [rainbowSwitchRow(false)] };

  it.each([
    ['test admin (test hesabı değil) kapalı', { ...base, country: 'TR', is_test_admin: true }, undefined, false],
    ['test admin açık ülke + açık platformda bile kapalı', { ...base, is_test_admin: true }, 'android', false],
    ['normal kullanıcı açık ülke + açık platformda kapalı', base, 'android', false],
    ['test hesabı açık (android)', { ...base, country: 'TR', is_test_account: true }, 'android', true],
    ['test hesabı açık (ios, ülke kapalı olsa da)', { ...base, country: 'ID', is_test_account: true }, 'ios', true],
    ['test hesabı + test admin açık', { ...base, is_test_admin: true, is_test_account: true }, 'ios', true],
    ['seed + test hesabı kapalı (bot iç test değil)', { ...base, is_seed_profile: true, is_test_account: true }, 'android', false],
    ['seed + test admin kapalı', { ...base, is_seed_profile: true, is_test_admin: true }, 'android', false],
  ] as const)('%s', async (_label, user, platform, expected) => {
    const { rainbowAccessService } = await setup(closed);
    await expect(rainbowAccessService.isEnabled(user, platform)).resolves.toBe(expected);
  });

  it('kapalıyken ülke tablosu hiç okunmaz', async () => {
    const { fake, rainbowAccessService } = await setup(closed);
    await rainbowAccessService.isEnabled(base, 'android');
    expect(fake.queries.filter((q) => q.table === 'reward_market_countries')).toHaveLength(0);
  });

  it('anahtar yoksa (eski config: rainbow bloğu yok) kapalı', async () => {
    const { rainbowAccessService } = await setup({
      economy_config_versions: [{ ...activeConfigRow(), config: configWithoutRainbow() }],
    });
    await expect(rainbowAccessService.isEnabled({ ...base, is_test_admin: true }, 'android')).resolves.toBe(false);
    await expect(rainbowAccessService.isEnabled({ ...base, is_test_account: true }, 'android')).resolves.toBe(true);
  });

  it('economy config okunamazsa kapalı sayılır (fail-closed), hata fırlatmaz, iz bırakır', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { rainbowAccessService } = await setup({}, { failOn: [{ table: 'economy_config_versions', op: 'select' }] });
      await expect(rainbowAccessService.isEnabled({ ...base, is_test_admin: true }, 'android')).resolves.toBe(false);
      await expect(rainbowAccessService.isEnabled({ ...base, is_test_account: true }, 'android')).resolves.toBe(true);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('[rainbow-access] economy config okunamadi'), expect.anything());
    } finally {
      logged.mockRestore();
    }
  });

  it('isEnabledForUser da aynı kaynaktan: test admin kapalı, test hesabı açık', async () => {
    const { rainbowAccessService } = await setup({
      ...closed,
      users: [{ id: 'adm', ...base, is_test_admin: true }, { id: 'qa', ...base, is_test_account: true }],
    });
    await expect(rainbowAccessService.isEnabledForUser('adm', 'android')).resolves.toBe(false);
    await expect(rainbowAccessService.isEnabledForUser('qa', 'android')).resolves.toBe(true);
  });
});

describe('rainbowAccessService.isEnabledForUser', () => {
  it('kullanıcı satırından karar verir', async () => {
    const { rainbowAccessService } = await setup({ users: [{ id: 'u1', ...base }] });
    await expect(rainbowAccessService.isEnabledForUser('u1', 'android')).resolves.toBe(true);
  });

  it('kullanıcı yoksa USER_NOT_FOUND', async () => {
    const { rainbowAccessService } = await setup({ users: [] });
    await expect(rainbowAccessService.isEnabledForUser('yok', 'android')).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });
});
