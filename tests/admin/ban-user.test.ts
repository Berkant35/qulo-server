import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

/**
 * Backoffice "Ban" butonu: users.is_banned + banned_at + ban_reason yazar ve
 * kullanicinin tum eslesmelerini pasife alir; "Unban" uc alani sifirlar.
 * Ekran daha once `is_deleted` okudugu icin ban sonrasi hicbir sey degismiyordu
 * (2026-09-25) — bu test aksiyonun DB'ye gercekten yazdigini kanitlar.
 */
function fakeRes() {
  const res: any = { redirectedTo: null as string | null, redirect(u: string) { res.redirectedTo = u; return res; } };
  return res;
}

async function setup(users: Record<string, unknown>[], matches: Record<string, unknown>[] = []) {
  const fake = createFakeSupabase({ users, matches, user_details: [] });
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

describe('userAction — ban / unban', () => {
  it('ban: is_banned, banned_at, ban_reason yazilir; eslesmeler pasife alinir', async () => {
    const { fake, adminController } = await setup(
      [{ id: 'u1', is_banned: false, banned_at: null, ban_reason: null, is_deleted: false }],
      [
        { id: 'm1', user1_id: 'u1', user2_id: 'u2', is_active: true },
        { id: 'm2', user1_id: 'u3', user2_id: 'u1', is_active: true },
        { id: 'm3', user1_id: 'u3', user2_id: 'u2', is_active: true },
      ],
    );

    await cagir(adminController, 'u1', 'ban');

    const u = fake.table('users')[0]!;
    expect(u.is_banned).toBe(true);
    expect(u.banned_at).toEqual(expect.any(String));
    expect(u.ban_reason).toBe('Banned by admin');
    expect(u.is_deleted).toBe(false);

    const byId = Object.fromEntries(fake.table('matches').map((m) => [m.id, m.is_active]));
    expect(byId).toEqual({ m1: false, m2: false, m3: true });
  });

  it('unban: uc alan sifirlanir', async () => {
    const { fake, adminController } = await setup([
      { id: 'u1', is_banned: true, banned_at: '2026-09-25T11:40:35Z', ban_reason: 'Banned by admin' },
    ]);

    await cagir(adminController, 'u1', 'unban');

    const u = fake.table('users')[0]!;
    expect(u.is_banned).toBe(false);
    expect(u.banned_at).toBeNull();
    expect(u.ban_reason).toBeNull();
  });
});
