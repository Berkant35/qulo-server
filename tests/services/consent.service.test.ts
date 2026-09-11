import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';

/**
 * Kayıt rızaları — KVKK denetim izi. Prod'daki 561 satırın hiçbirinde platform
 * ya da sürüm yoktu: servis alanları kabul ediyordu ama çağıran hiç geçirmiyordu.
 */

const UID = '11111111-1111-4111-8111-111111111111';

async function setup(seed: Tables = {}, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase({ user_consents: [], ...seed }, options);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { consentService } = await import('../../src/services/consent.service.js');
  return { fake, consentService };
}

beforeEach(() => {
  vi.resetModules();
});

describe('consentService.recordRegistrationConsents', () => {
  it('üç zorunlu rızayı istemci platformu ve sürümüyle yazar', async () => {
    const { fake, consentService } = await setup();

    await consentService.recordRegistrationConsents(UID, { platform: 'ios', appVersion: '2.0.10+73' });

    const rows = fake.table('user_consents');
    expect(rows.map((r) => r.consent_type).sort())
      .toEqual(['kvkk_explicit', 'privacy_policy', 'terms_of_service']);
    for (const row of rows) {
      expect(row).toMatchObject({ user_id: UID, version: '1.0', platform: 'ios', app_version: '2.0.10+73' });
    }
  });

  it('meta yoksa (eski istemci) rıza yine de kaydedilir', async () => {
    const { fake, consentService } = await setup();

    await consentService.recordRegistrationConsents(UID);

    const rows = fake.table('user_consents');
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.platform == null && r.app_version == null)).toBe(true);
  });

  it('aynı sürüm ikinci kez kaydedilirse satır çoğalmaz, son değer kalır', async () => {
    const { fake, consentService } = await setup();

    await consentService.recordRegistrationConsents(UID, { platform: 'ios' });
    await consentService.recordRegistrationConsents(UID, { platform: 'android' });

    const rows = fake.table('user_consents');
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.platform === 'android')).toBe(true);
  });

  it('başka kullanıcının rızasına dokunmaz', async () => {
    const OTHER = '22222222-2222-4222-8222-222222222222';
    const { fake, consentService } = await setup();

    await consentService.recordRegistrationConsents(OTHER, { platform: 'ios' });
    await consentService.recordRegistrationConsents(UID, { platform: 'android' });

    const others = fake.table('user_consents').filter((r) => r.user_id === OTHER);
    expect(others).toHaveLength(3);
    expect(others.every((r) => r.platform === 'ios')).toBe(true);
  });

  it('rıza yazılamazsa hata fırlatır — çağıran loglar', async () => {
    const { consentService } = await setup({}, { failOn: [{ table: 'user_consents', op: 'insert' }] });

    await expect(consentService.recordRegistrationConsents(UID)).rejects.toThrow(/Consent recording failed/);
  });
});
