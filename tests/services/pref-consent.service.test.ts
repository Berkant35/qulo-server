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

  it('yarış: GRANTED ispat yazarken araya DECLINED girerse GRANTED reddedilir (CONSENT_RELOCK), tercih seçilemez', async () => {
    // DECLINED, GRANTED'ın okuması ile yazımı arasına düşer: users update'i anında satır DECLINED olur.
    const { fake, prefConsentService, row } = await setup([me()], {
      interleave: [{ table: 'users', mutate: (rows) => Object.assign(rows[0], {
        gender_pref: null, gender_pref_set_at: null, pref_consent_status: 'DECLINED', pref_consent_at: SET,
      }) }],
    });
    await expect(prefConsentService.setConsent(ME, { status: 'GRANTED', version: V, gender_pref: 'WOMAN' }))
      .rejects.toMatchObject({ code: 'CONSENT_RELOCK' });
    expect(row()).toMatchObject({ gender_pref: null, gender_pref_set_at: null, pref_consent_status: 'DECLINED' });
    // Yarışı kaybeden GRANTED'ın ispat satırı denetim izi olarak kalır.
    expect(fake.table('user_consents')).toHaveLength(1);
  });

  it('yarış: eski kullanıcının GRANTED\'ı sürerken araya DECLINED girerse tercih geri gelmez', async () => {
    const { prefConsentService, row } = await setup([me({ gender_pref: 'MAN', gender_pref_set_at: SET })], {
      interleave: [{ table: 'users', mutate: (rows) => Object.assign(rows[0], {
        gender_pref: null, gender_pref_set_at: null, pref_consent_status: 'DECLINED',
      }) }],
    });
    await expect(prefConsentService.setConsent(ME, { status: 'GRANTED', version: V }))
      .rejects.toMatchObject({ code: 'CONSENT_RELOCK' });
    expect(row()).toMatchObject({ gender_pref: null, gender_pref_set_at: null, pref_consent_status: 'DECLINED' });
  });

  it('yarış: eski kullanıcının GRANTED\'ı sürerken tercih başka değere değişirse GENDER_PREF_LOCKED, değişiklik ezilmez', async () => {
    const { prefConsentService, row } = await setup([me({ gender_pref: 'MAN', gender_pref_set_at: SET })], {
      interleave: [{ table: 'users', mutate: (rows) => Object.assign(rows[0], { gender_pref: 'WOMAN' }) }],
    });
    await expect(prefConsentService.setConsent(ME, { status: 'GRANTED', version: V }))
      .rejects.toMatchObject({ code: 'GENDER_PREF_LOCKED' });
    expect(row()).toMatchObject({ gender_pref: 'WOMAN', pref_consent_status: null });
  });

  it('aynı tercihle iki kez GRANTED idempotent: tercih ve set_at korunur', async () => {
    const { prefConsentService, row } = await setup([me()]);
    await prefConsentService.setConsent(ME, { status: 'GRANTED', version: V, gender_pref: 'WOMAN' });
    const setAt = row().gender_pref_set_at;
    await expect(prefConsentService.setConsent(ME, { status: 'GRANTED', version: V, gender_pref: 'WOMAN' }))
      .resolves.toMatchObject({ gender_pref: 'WOMAN', pref_consent_status: 'GRANTED' });
    expect(row()).toMatchObject({ gender_pref: 'WOMAN', gender_pref_set_at: setAt, pref_consent_status: 'GRANTED' });
  });

  it('eşzamanlı aynı ilk seçim (yeniden deneme) idempotent: ikinci istek başarı döner', async () => {
    // İkinci isteğin yazımından hemen önce ilki aynı tercihi yazmış olur.
    const { prefConsentService, row } = await setup([me()], {
      interleave: [{ table: 'users', mutate: (rows) => Object.assign(rows[0], {
        gender_pref: 'WOMAN', gender_pref_set_at: SET, pref_consent_status: 'GRANTED',
      }) }],
    });
    await expect(prefConsentService.setConsent(ME, { status: 'GRANTED', version: V, gender_pref: 'WOMAN' }))
      .resolves.toMatchObject({ gender_pref: 'WOMAN', pref_consent_status: 'GRANTED' });
    expect(row().gender_pref_set_at).toBe(SET);
  });

  it('eşzamanlı farklı ilk seçim: ikincisi GENDER_PREF_LOCKED, ilk tercih ezilmez', async () => {
    const { prefConsentService, row } = await setup([me()], {
      interleave: [{ table: 'users', mutate: (rows) => Object.assign(rows[0], {
        gender_pref: 'MAN', gender_pref_set_at: SET, pref_consent_status: 'GRANTED',
      }) }],
    });
    await expect(prefConsentService.setConsent(ME, { status: 'GRANTED', version: V, gender_pref: 'WOMAN' }))
      .rejects.toMatchObject({ code: 'GENDER_PREF_LOCKED' });
    expect(row()).toMatchObject({ gender_pref: 'MAN', gender_pref_set_at: SET });
  });

  it('kullanıcı yoksa USER_NOT_FOUND', async () => {
    const { prefConsentService } = await setup([]);
    await expect(prefConsentService.setConsent(ME, { status: 'DECLINED', version: V })).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });
});
