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

describe('adminService.updateGender — destek talebiyle cinsiyet değişikliği', () => {
  it('cinsiyeti yazar; log değer içermez', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { fake, adminService } = await setup({ gender: 'MAN' });
    await adminService.updateGender(U, 'WOMAN', 'admin@qulo.test');
    expect(fake.table('users')[0].gender).toBe('WOMAN');
    expect(log.mock.calls.flat().join(' ')).not.toMatch(/\bMAN\b|\bWOMAN\b/);
    log.mockRestore();
  });

  it('silinmiş kullanıcıya dokunmaz', async () => {
    const { fake, adminService } = await setup({ gender: 'MAN', is_deleted: true });
    await adminService.updateGender(U, 'WOMAN', 'admin@qulo.test');
    expect(fake.table('users')[0].gender).toBe('MAN');
  });
});
