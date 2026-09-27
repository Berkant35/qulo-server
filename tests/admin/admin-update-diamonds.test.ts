import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';

async function setup(seed: Tables) {
  const fake = createFakeSupabase(seed);
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

describe('adminService.updateDiamonds', () => {
  it('mor düşürülürse ödenmiş sayaç bakiyeye sıkıştırılır', async () => {
    const { fake, adminService } = await setup({ users: [user()] });
    await adminService.updateDiamonds('u1', 10, 30, 5);
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 30, purple_paid: 30 });
  });

  it('rainbow ayarlanır ve her değişen tür ADMIN_ADJUST satırı yazar', async () => {
    const { fake, adminService } = await setup({ users: [user()] });
    await adminService.updateDiamonds('u1', 15, 100, 25);
    expect(fake.table('users')[0]).toMatchObject({ green_diamonds: 15, rainbow_diamonds: 25 });
    expect(fake.table('diamond_transactions').map((t) => [t.type, t.amount, t.reason])).toEqual([
      ['GREEN', 5, 'ADMIN_ADJUST'],
      ['RAINBOW', 20, 'ADMIN_ADJUST'],
    ]);
  });

  it('değişiklik yoksa satır yazmaz', async () => {
    const { fake, adminService } = await setup({ users: [user()] });
    await adminService.updateDiamonds('u1', 10, 100, 5);
    expect(fake.table('diamond_transactions')).toHaveLength(0);
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

async function setupController(seed: Tables) {
  const fake = createFakeSupabase(seed);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { adminController } = await import('../../src/admin/admin.controller.js');
  return { fake, adminController };
}

describe('userAction — update_diamonds', () => {
  it('rainbow_diamonds negatifse servis çağrılmadan invalid_diamonds redirect döner', async () => {
    const { fake, adminController } = await setupController({ users: [user()] });
    const res = fakeRes();

    await adminController.userAction(
      {
        params: { id: 'u1' },
        body: { action: 'update_diamonds', green_diamonds: '10', purple_diamonds: '100', rainbow_diamonds: '-1' },
        session: {},
      } as never,
      res,
    );

    expect(res.redirectedTo).toBe('/admin/users/u1?error=invalid_diamonds');
    expect(fake.table('users')[0]).toMatchObject({ green_diamonds: 10, purple_diamonds: 100, rainbow_diamonds: 5 });
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });
});
