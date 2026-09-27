import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';

async function setup(seed: Tables = {}, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase(
    {
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
