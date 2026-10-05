import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

const U = '11111111-1111-4111-8111-111111111111';

async function setup(row: Record<string, unknown>) {
  const fake = createFakeSupabase({ users: [{ id: U, is_deleted: false, ...row }] });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { adminService } = await import('../../src/admin/admin.service.js');
  return { fake, adminService };
}

beforeEach(() => vi.resetModules());

describe('adminService.updateGenderPref — destek talebiyle tercih değişikliği', () => {
  it('tercihi yazar, set_at damgalar, rızayı NULL\'a çeker (kullanıcı yeniden onaylar)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { fake, adminService } = await setup({ gender_pref: 'WOMAN', gender_pref_set_at: '2026-09-01T00:00:00Z', pref_consent_status: 'GRANTED', pref_consent_at: '2026-10-01T00:00:00Z' });
    await adminService.updateGenderPref(U, 'MAN', 'admin@qulo.test');
    const row = fake.table('users')[0];
    expect(row).toMatchObject({ gender_pref: 'MAN', pref_consent_status: null, pref_consent_at: null });
    expect(row.gender_pref_set_at).not.toBe('2026-09-01T00:00:00Z');
    // Log tercih DEĞERİNİ içermez (özel nitelikli veri log'a yazılmaz).
    expect(log.mock.calls.flat().join(' ')).not.toMatch(/\bMAN\b|\bWOMAN\b|\bBOTH\b/);
  });
});
