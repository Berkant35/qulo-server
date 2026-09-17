import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

/**
 * Seed (bot) profilleri discover'da yalniz `is_test_admin` tasiyan kullaniciya gorunur
 * (matching.service.ts:175). Ekiple test etmenin dogru anahtari bu; seed'lerin
 * `is_test_account` bayragina dokunmak hem botlari gercek kullanicilara acar hem de
 * botun yazma kapisini kapatir.
 */
function fakeRes() {
  const res: any = { redirectedTo: null as string | null, redirect(u: string) { res.redirectedTo = u; return res; } };
  return res;
}

async function setup(tablo: Record<string, unknown>[]) {
  const fake = createFakeSupabase({ users: tablo, matches: [], user_details: [] });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { adminController } = await import('../../src/admin/admin.controller.js');
  return { fake, adminController };
}

const cagir = async (c: any, id: string, action: string) => {
  const res = fakeRes();
  await c.userAction({ params: { id }, body: { action }, session: {} } as never, res);
  return res;
};

beforeEach(() => vi.resetModules());

describe('userAction — test admin anahtari', () => {
  it('test_admin_on bayragi acar, test_admin_off kapatir', async () => {
    const { fake, adminController } = await setup([{ id: 'u1', is_test_admin: false, is_test_account: false }]);

    await cagir(adminController, 'u1', 'test_admin_on');
    expect(fake.table('users')[0]!.is_test_admin).toBe(true);

    await cagir(adminController, 'u1', 'test_admin_off');
    expect(fake.table('users')[0]!.is_test_admin).toBe(false);
  });

  it('seed profillerin is_test_account bayragina DOKUNMAZ', async () => {
    // En yuksek sonuclu hata: seed'i "herkese acmak" icin is_test_account'u dusurmek.
    // O bayrak hem discover kapisi hem botun yazma kapisi (botYazabilir).
    const { fake, adminController } = await setup([
      { id: 'u1', is_test_admin: false, is_test_account: false },
      { id: 'seed1', is_seed_profile: true, is_test_account: true },
    ]);

    await cagir(adminController, 'u1', 'test_admin_on');

    const seed = fake.table('users').find((u: Record<string, unknown>) => u.id === 'seed1')!;
    expect(seed.is_test_account).toBe(true);
    expect(seed.is_seed_profile).toBe(true);
  });

  it('kullaniciyi detay sayfasina geri yollar', async () => {
    const { adminController } = await setup([{ id: 'u1', is_test_admin: false }]);
    const res = await cagir(adminController, 'u1', 'test_admin_on');
    expect(res.redirectedTo).toBe('/admin/users/u1');
  });
});
