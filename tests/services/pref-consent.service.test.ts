import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';

const ME = '11111111-1111-4111-8111-111111111111';
const V = '2026-10-v1';
const SET = '2026-09-01T00:00:00Z';

const me = (over: Record<string, unknown> = {}) => ({
  id: ME, is_deleted: false, gender_pref: null, gender_pref_set_at: null, pref_consent_status: null, pref_consent_at: null, ...over,
});

async function setup(users: Tables['users'], options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase({ users, user_consents: [] }, options);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { prefConsentService } = await import('../../src/services/pref-consent.service.js');
  return { fake, prefConsentService, row: () => fake.table('users')[0] };
}

beforeEach(() => vi.resetModules());

describe('prefConsentService.setConsent', () => {
  it('ilk seçim + GRANTED: tercih, set_at, rıza ve ispat birlikte yazılır', async () => {
    const { fake, prefConsentService, row } = await setup([me()]);
    await prefConsentService.setConsent(ME, { status: 'GRANTED', version: V, gender_pref: 'WOMAN' }, { platform: 'ios', appVersion: '2.0.15' });
    expect(row()).toMatchObject({ gender_pref: 'WOMAN', pref_consent_status: 'GRANTED' });
    expect(row().gender_pref_set_at).toEqual(expect.any(String));
    expect(fake.table('user_consents')).toEqual([
      expect.objectContaining({ user_id: ME, consent_type: 'match_preference', version: V, platform: 'ios', app_version: '2.0.15' }),
    ]);
  });

  it('ilk seçimde tercih yoksa GENDER_PREF_REQUIRED, hiçbir şey yazılmaz', async () => {
    const { fake, prefConsentService, row } = await setup([me()]);
    await expect(prefConsentService.setConsent(ME, { status: 'GRANTED', version: V })).rejects.toMatchObject({ code: 'GENDER_PREF_REQUIRED' });
    expect(row().pref_consent_status).toBeNull();
    expect(fake.table('user_consents')).toHaveLength(0);
  });

  it('eski kullanıcı (rızasız tercih) GRANTED verir: tercih korunur, rıza yazılır', async () => {
    const { prefConsentService, row } = await setup([me({ gender_pref: 'MAN', gender_pref_set_at: SET })]);
    await prefConsentService.setConsent(ME, { status: 'GRANTED', version: V });
    expect(row()).toMatchObject({ gender_pref: 'MAN', gender_pref_set_at: SET, pref_consent_status: 'GRANTED' });
  });

  it('seçilmiş tercihten farklı bir tercihle GRANTED: GENDER_PREF_LOCKED', async () => {
    const { prefConsentService, row } = await setup([me({ gender_pref: 'MAN', gender_pref_set_at: SET })]);
    await expect(prefConsentService.setConsent(ME, { status: 'GRANTED', version: V, gender_pref: 'WOMAN' }))
      .rejects.toMatchObject({ code: 'GENDER_PREF_LOCKED' });
    expect(row().gender_pref).toBe('MAN');
  });

  it('DECLINED: tercih ve set_at silinir, durum DECLINED, ispat satırı yazılmaz', async () => {
    const { fake, prefConsentService, row } = await setup([me({ gender_pref: 'MAN', gender_pref_set_at: SET, pref_consent_status: 'GRANTED' })]);
    await prefConsentService.setConsent(ME, { status: 'DECLINED', version: V });
    expect(row()).toMatchObject({ gender_pref: null, gender_pref_set_at: null, pref_consent_status: 'DECLINED' });
    expect(row().pref_consent_at).toEqual(expect.any(String));
    expect(fake.table('user_consents')).toHaveLength(0);
  });

  it('DECLINED sonrası GRANTED: CONSENT_RELOCK (kilit dolanma yolu kapalı)', async () => {
    const { prefConsentService, row } = await setup([me({ pref_consent_status: 'DECLINED' })]);
    await expect(prefConsentService.setConsent(ME, { status: 'GRANTED', version: V, gender_pref: 'WOMAN' }))
      .rejects.toMatchObject({ code: 'CONSENT_RELOCK', statusCode: 409 });
    expect(row().gender_pref).toBeNull();
  });

  it('ispat yazımı düşerse durum değişmez (rızasız işleme yok)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // fake'te `upsert` de `op: 'insert'` ile hedeflenir (fake-supabase.ts FailureSpec).
    const { prefConsentService, row } = await setup([me()], { failOn: [{ table: 'user_consents', op: 'insert' }] });
    await expect(prefConsentService.setConsent(ME, { status: 'GRANTED', version: V, gender_pref: 'MAN' })).rejects.toThrow();
    expect(row()).toMatchObject({ gender_pref: null, pref_consent_status: null });
  });

  it('kullanıcı yoksa USER_NOT_FOUND', async () => {
    const { prefConsentService } = await setup([]);
    await expect(prefConsentService.setConsent(ME, { status: 'DECLINED', version: V })).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });
});
