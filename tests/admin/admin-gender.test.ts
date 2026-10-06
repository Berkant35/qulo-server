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

  it('silinmiş kullanıcıya dokunmaz ve hata verir (sessiz başarı yok)', async () => {
    const { fake, adminService } = await setup({ gender: 'MAN', is_deleted: true });
    await expect(adminService.updateGender(U, 'WOMAN', 'admin@qulo.test')).rejects.toThrow('user not found or deleted');
    expect(fake.table('users')[0].gender).toBe('MAN');
  });

  it('bilinmeyen id: hata', async () => {
    const { adminService } = await setup({ gender: 'MAN' });
    await expect(adminService.updateGender('99999999-9999-4999-8999-999999999999', 'WOMAN', 'admin@qulo.test'))
      .rejects.toThrow('user not found or deleted');
  });

  it('supabase hatası: "gender update failed" ile reddeder', async () => {
    const fake = createFakeSupabase({ users: [{ id: U, is_deleted: false, gender: 'MAN' }] },
      { failOn: [{ table: 'users', op: 'update', error: { code: 'XX000', message: 'boom' } }] });
    vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
    const { adminService } = await import('../../src/admin/admin.service.js');
    await expect(adminService.updateGender(U, 'WOMAN', 'admin@qulo.test')).rejects.toThrow('gender update failed');
    expect(fake.table('users')[0].gender).toBe('MAN');
  });
});
