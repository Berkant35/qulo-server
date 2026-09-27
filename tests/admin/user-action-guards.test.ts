import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';

function fakeRes() {
  const res: any = {
    statusCode: 200,
    redirectedTo: null as string | null,
    rendered: null as null | { view: string; locals: any },
    redirect(u: string) { res.redirectedTo = u; return res; },
    status(c: number) { res.statusCode = c; return res; },
    render(view: string, locals: any) { res.rendered = { view, locals }; return res; },
  };
  return res;
}

async function setup(seed: Tables, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase({ diamond_transactions: [], user_details: [], questions: [], swipes: [], ...seed }, options);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { adminController } = await import('../../src/admin/admin.controller.js');
  return { fake, adminController };
}

const user = () => ({
  id: 'u1', email: 'ali@example.com', green_diamonds: 10, purple_diamonds: 100, purple_paid: 0,
  rainbow_diamonds: 5, is_test_admin: false, rainbow_flagged_at: '2026-09-25T00:00:00Z',
});

const SUPER = { adminId: 'adm1', adminRole: 'SUPER_ADMIN' };
const ADMIN = { adminId: 'adm2', adminRole: 'ADMIN' };
const act = (action: string, session: Record<string, string>, body: Record<string, string> = {}) =>
  ({ params: { id: 'u1' }, body: { action, ...body }, session, query: {} }) as never;

beforeEach(() => {
  vi.resetModules();
});

describe('userAction — süper admin kapısı (para + görünürlük)', () => {
  it.each(['update_diamonds', 'test_admin_on', 'test_admin_off', 'clear_rainbow_flag'])(
    '%s: süper admin değilse ?error=forbidden, hiçbir şey değişmez',
    async (action) => {
      const { fake, adminController } = await setup({ users: [user()] });
      const res = fakeRes();
      await adminController.userAction(act(action, ADMIN, { green_diamonds: '99', purple_diamonds: '100' }), res);

      expect(res.redirectedTo).toBe('/admin/users/u1?error=forbidden');
      expect(fake.table('users')[0]).toMatchObject({
        green_diamonds: 10, is_test_admin: false, rainbow_flagged_at: '2026-09-25T00:00:00Z',
      });
      expect(fake.table('diamond_transactions')).toHaveLength(0);
    },
  );

  it('moderasyon eylemi (reset_swipes) süper admin gerektirmez', async () => {
    const { adminController } = await setup({ users: [user()] });
    const res = fakeRes();
    await adminController.userAction(act('reset_swipes', ADMIN), res);
    expect(res.redirectedTo).toBe('/admin/users/u1');
  });

  it('süper admin rainbow uyarısını kaldırır', async () => {
    const { fake, adminController } = await setup({ users: [user()] });
    const res = fakeRes();
    await adminController.userAction(act('clear_rainbow_flag', SUPER), res);
    expect(fake.table('users')[0].rainbow_flagged_at).toBeNull();
    expect(res.redirectedTo).toBe('/admin/users/u1');
  });

  it('dal hatası isteği asılı bırakmaz: ?error=action_failed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { adminController } = await setup({ users: [user()] }, { failOn: [{ table: 'users', op: 'update' }] });
    const res = fakeRes();
    await adminController.userAction(act('test_admin_on', SUPER), res);
    expect(res.redirectedTo).toBe('/admin/users/u1?error=action_failed');
    errorSpy.mockRestore();
  });
});

describe('userDetail — hata bandı', () => {
  it('?error= kodu mesaja çevrilir; bilinmeyen ya da prototip kodu gösterilmez', async () => {
    const { adminController } = await setup({ users: [user()] });

    const res = fakeRes();
    await adminController.userDetail({ params: { id: 'u1' }, query: { error: 'forbidden' }, session: SUPER } as never, res);
    expect(res.rendered.view).toBe('user-detail');
    expect(res.rendered.locals.error).toMatch(/süper admin/);

    const res2 = fakeRes();
    await adminController.userDetail({ params: { id: 'u1' }, query: { error: 'constructor' }, session: SUPER } as never, res2);
    expect(res2.rendered.locals.error).toBeNull();
  });
});
