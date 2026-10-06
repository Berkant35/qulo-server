import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Cinsiyet kovası ikili (MAN/WOMAN): controller katmanı OTHER/boş/keyfi değeri servise
 * ulaştırmadan reddeder (spec 2026-10-06).
 */
const U = '11111111-1111-4111-8111-111111111111';

function fakeRes() {
  const res: any = { redirectedTo: null as string | null, redirect(u: string) { res.redirectedTo = u; return res; } };
  return res;
}

async function setup() {
  const updateGender = vi.fn(async () => undefined);
  vi.doMock('../../src/admin/admin.service.js', () => ({ adminService: { updateGender } }));
  const { adminController } = await import('../../src/admin/admin.controller.js');
  return { updateGender, adminController };
}

const cagir = async (c: any, gender: unknown, id: string = U) => {
  const res = fakeRes();
  await c.updateUserGender({ params: { id }, body: { gender }, session: { adminEmail: 'admin@qulo.test' } } as never, res);
  return res;
};

beforeEach(() => vi.resetModules());

describe('adminController.updateUserGender — allow-list', () => {
  it.each(['OTHER', '', 'man', 'BOTH', undefined])('%j reddedilir: hata yönlendirmesi, updateGender çağrılmaz', async (value) => {
    const { updateGender, adminController } = await setup();
    const res = await cagir(adminController, value);
    expect(res.redirectedTo).toBe(`/admin/users/${U}?error=${encodeURIComponent('Invalid gender value')}`);
    expect(updateGender).not.toHaveBeenCalled();
  });

  it.each(['MAN', 'WOMAN'])('%s kabul edilir: servise iletilir, başarı yönlendirmesi', async (value) => {
    const { updateGender, adminController } = await setup();
    const res = await cagir(adminController, value);
    expect(updateGender).toHaveBeenCalledWith(U, value, 'admin@qulo.test');
    expect(res.redirectedTo).toBe(`/admin/users/${U}?success=${encodeURIComponent('Gender updated')}`);
  });

  it.each(['abc', "1' or '1'='1", '../x', ''])('geçersiz :id %j reddedilir: genel hata, servis çağrılmaz, id URL\'ye yansımaz', async (badId) => {
    const { updateGender, adminController } = await setup();
    const res = await cagir(adminController, 'MAN', badId);
    expect(res.redirectedTo).toBe(`/admin/users?error=${encodeURIComponent('Invalid user id')}`);
    expect(updateGender).not.toHaveBeenCalled();
  });
});
