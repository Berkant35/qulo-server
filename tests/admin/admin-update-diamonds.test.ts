import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';

async function setup(seed: Tables, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase(seed, options);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { adminService } = await import('../../src/admin/admin.service.js');
  return { fake, adminService };
}

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1', green_diamonds: 10, purple_diamonds: 100, purple_paid: 80, rainbow_diamonds: 5, ...over,
});

beforeEach(() => {
  vi.resetModules();
});

/**
 * Admin bakiye düzenlemesi defterin CAS yolundan geçer (diamondService.setBalances, F6):
 * sıkıştırma TAZE satırdan hesaplanır (bayat okuma purple_paid'i yeniden şişiremez), her değişen
 * tür için tek ADMIN_ADJUST satırı `admin:<adminId>` referansıyla yazılır.
 */
describe('adminService.updateDiamonds', () => {
  it('mor düşürülürse ödenmiş sayaç bakiyeye sıkıştırılır; düşen ödenmiş PURPLE satırında paid_amount', async () => {
    const { fake, adminService } = await setup({ users: [user()] });
    await adminService.updateDiamonds('u1', 10, 30, 5, 'adm1');
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 30, purple_paid: 30 });
    expect(fake.table('diamond_transactions')).toEqual([
      expect.objectContaining({ type: 'PURPLE', amount: -70, reason: 'ADMIN_ADJUST', reference_id: 'admin:adm1', paid_amount: 50 }),
    ]);
  });

  it('rainbow ayarlanır ve her değişen tür ADMIN_ADJUST satırı yazar (admin referansıyla)', async () => {
    const { fake, adminService } = await setup({ users: [user()] });
    await adminService.updateDiamonds('u1', 15, 100, 25, 'adm1');
    expect(fake.table('users')[0]).toMatchObject({ green_diamonds: 15, rainbow_diamonds: 25 });
    expect(fake.table('diamond_transactions').map((t) => [t.type, t.amount, t.reason, t.reference_id])).toEqual([
      ['GREEN', 5, 'ADMIN_ADJUST', 'admin:adm1'],
      ['RAINBOW', 20, 'ADMIN_ADJUST', 'admin:adm1'],
    ]);
  });

  it('değişiklik yoksa satır yazmaz', async () => {
    const { fake, adminService } = await setup({ users: [user()] });
    await adminService.updateDiamonds('u1', 10, 100, 5, 'adm1');
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it('rainbow verilmezse (undefined) bakiye korunur', async () => {
    const { fake, adminService } = await setup({ users: [user()] });
    await adminService.updateDiamonds('u1', 12, 100, undefined, 'adm1');
    expect(fake.table('users')[0]).toMatchObject({ green_diamonds: 12, rainbow_diamonds: 5 });
    expect(fake.table('diamond_transactions').map((t) => t.type)).toEqual(['GREEN']);
  });

  it('sayfa yüklemesi ile gönderim arasında ödenmiş sayaç düşerse sıkıştırma TAZE satırdan (yeniden şişmez)', async () => {
    const { fake, adminService } = await setup(
      { users: [user({ purple_diamonds: 100, purple_paid: 80 })] },
      { interleave: [{ table: 'users', mutate: (rows) => { rows[0].purple_diamonds = 40; rows[0].purple_paid = 20; } }] },
    );

    await adminService.updateDiamonds('u1', 10, 60, 5, 'adm1');

    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 60, purple_paid: 20 });
    // Defter taze satıra göre: 40 → 60 = +20 (bayat 100 → 60 = -70 değil).
    expect(fake.table('diamond_transactions')).toEqual([
      expect.objectContaining({ type: 'PURPLE', amount: 20, reference_id: 'admin:adm1' }),
    ]);
  });
});

/**
 * Controller katmanı: `update_diamonds` dalı negatif/NaN değerleri servise hiç
 * göndermeden `?error=invalid_diamonds` ile geri döner (bkz. tests/admin/test-admin-toggle.test.ts
 * ve ban-user.test.ts'deki fakeRes/cagir kalıbı — supabase mock'lanır, gerçek controller çağrılır).
 */
function fakeRes() {
  const res: any = { redirectedTo: null as string | null, redirect(u: string) { res.redirectedTo = u; return res; } };
  return res;
}

async function setupController(seed: Tables, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase(seed, options);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { adminController } = await import('../../src/admin/admin.controller.js');
  return { fake, adminController };
}

const updateReq = (body: Record<string, unknown>) => ({
  params: { id: 'u1' },
  body: { action: 'update_diamonds', ...body },
  session: { adminId: 'adm1' },
}) as never;

describe('userAction — update_diamonds', () => {
  it('rainbow_diamonds negatifse servis çağrılmadan invalid_diamonds redirect döner', async () => {
    const { fake, adminController } = await setupController({ users: [user()] });
    const res = fakeRes();

    await adminController.userAction(
      updateReq({ green_diamonds: '10', purple_diamonds: '100', rainbow_diamonds: '-1' }),
      res,
    );

    expect(res.redirectedTo).toBe('/admin/users/u1?error=invalid_diamonds');
    expect(fake.table('users')[0]).toMatchObject({ green_diamonds: 10, purple_diamonds: 100, rainbow_diamonds: 5 });
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it('rainbow alanı yoksa "değişmedi" demektir — 0\'lanmaz', async () => {
    const { fake, adminController } = await setupController({ users: [user()] });
    const res = fakeRes();

    await adminController.userAction(updateReq({ green_diamonds: '11', purple_diamonds: '100' }), res);

    expect(res.redirectedTo).toBe('/admin/users/u1');
    expect(fake.table('users')[0]).toMatchObject({ green_diamonds: 11, rainbow_diamonds: 5 });
  });

  it('boş rainbow alanı da "değişmedi"', async () => {
    const { fake, adminController } = await setupController({ users: [user()] });
    const res = fakeRes();

    await adminController.userAction(
      updateReq({ green_diamonds: '10', purple_diamonds: '100', rainbow_diamonds: '  ' }),
      res,
    );

    expect(res.redirectedTo).toBe('/admin/users/u1');
    expect(fake.table('users')[0].rainbow_diamonds).toBe(5);
  });

  it('servis hata verirse istek asılı kalmaz: ?error=update_failed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fake, adminController } = await setupController(
      { users: [user()] },
      { failOn: [{ table: 'users', op: 'update' }] },
    );
    const res = fakeRes();

    await adminController.userAction(
      updateReq({ green_diamonds: '20', purple_diamonds: '100', rainbow_diamonds: '5' }),
      res,
    );

    expect(res.redirectedTo).toBe('/admin/users/u1?error=update_failed');
    expect(fake.table('users')[0].green_diamonds).toBe(10);
    errorSpy.mockRestore();
  });
});
