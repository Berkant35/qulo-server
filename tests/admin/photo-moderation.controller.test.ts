import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

/**
 * Backoffice review kuyrugu: 2026-09-25 → 10-07 arasi 21 `review` satiri hic goruntulenmedi (sayfa yoktu),
 * biri gercek cinsel icerikti. Bu testler listenin sahibini/profil durumunu dogru bagladigini ve
 * Ban/Safe aksiyonunun DB + ban servisine gercekten yazdigini kanitlar.
 */
const U1 = '11111111-1111-4111-8111-111111111111';
const C1 = '22222222-2222-4222-8222-222222222222';

function fakeRes() {
  const res: any = {
    rendered: null as null | { view: string; locals: any }, redirectedTo: null as string | null, statusCode: 200,
    render(view: string, locals: any) { res.rendered = { view, locals }; return res; },
    redirect(u: string) { res.redirectedTo = u; return res; },
    status(c: number) { res.statusCode = c; return res; },
  };
  return res;
}

async function setup(opts: { checks?: Record<string, unknown>[]; users?: Record<string, unknown>[] } = {}) {
  const fake = createFakeSupabase({
    photo_moderation_checks: opts.checks ?? [
      { id: C1, user_id: U1, photo_url: 'https://x/a.jpg', verdict: 'review', reason: 'tarama(true): exposed genitals | onay(false): none', model: 'm', attempts: 1, checked_at: '2026-10-07T11:21:35Z' },
      { id: '33333333-3333-4333-8333-333333333333', user_id: U1, photo_url: 'https://x/old.jpg', verdict: 'safe', reason: 'clean', model: 'm', attempts: 1, checked_at: '2026-10-01T00:00:00Z' },
    ],
    users: opts.users ?? [{ id: U1, email: 'a@b.c', name: 'Mo', is_banned: false, photos: ['https://x/a.jpg'] }],
    app_config: [{ id: 'cfg', photo_moderation_enabled: true }],
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  vi.doMock('../../src/config/env.js', () => ({ env: { NVIDIA_API_KEY: 'nv', GEMINI_API_KEY: 'g' } }));
  const banUser = vi.fn(async () => true);
  vi.doMock('../../src/services/ban.service.js', () => ({ banService: { banUser } }));
  const { photoModerationAdminController: c } = await import('../../src/admin/photo-moderation.admin.controller.js');
  return { fake, c, banUser };
}

beforeEach(() => vi.resetModules());

describe('photoModerationAdminController.page', () => {
  it('varsayilan review filtresi: yalniz review satirlari, sahibi ve "hala profilde" bilgisiyle', async () => {
    const { c } = await setup();
    const res = fakeRes();
    await c.page({ query: {}, session: { csrfToken: 't' } } as never, res);
    expect(res.rendered?.view).toBe('photo-moderation');
    expect(res.rendered?.locals.verdict).toBe('review');
    expect(res.rendered?.locals.total).toBe(1);
    expect(res.rendered?.locals.rows[0]).toMatchObject({ id: C1, email: 'a@b.c', name: 'Mo', is_banned: false, hala_profilde: true });
  });

  it('safe filtresi + profilden kaldirilmis fotograf isaretlenir; bilinmeyen verdict review\'a duser', async () => {
    const { c } = await setup();
    const res = fakeRes();
    await c.page({ query: { verdict: 'safe' }, session: {} } as never, res);
    expect(res.rendered?.locals.rows[0]).toMatchObject({ photo_url: 'https://x/old.jpg', hala_profilde: false });
    const res2 = fakeRes();
    await c.page({ query: { verdict: 'DROP TABLE' }, session: {} } as never, res2);
    expect(res2.rendered?.locals.verdict).toBe('review');
  });
});

describe('photoModerationAdminController.action', () => {
  it('servis hatasi -> 500 error sayfasi (istek askida kalmaz)', async () => {
    const { c, banUser } = await setup();
    banUser.mockRejectedValueOnce(new Error('db down'));
    const res = fakeRes();
    await c.action({ params: { id: C1 }, body: { action: 'ban' }, session: {} } as never, res);
    expect(res.statusCode).toBe(500);
    expect(res.rendered?.view).toBe('error');
    expect(res.redirectedTo).toBeNull();
  });

  it('ban: banService sexual_content ile cagrilir, satir explicit/admin olur, return_to\'ya doner', async () => {
    const { c, fake, banUser } = await setup();
    const res = fakeRes();
    await c.action({ params: { id: C1 }, body: { action: 'ban', return_to: '/admin/photo-moderation?verdict=review&page=2' }, session: {} } as never, res);
    expect(banUser).toHaveBeenCalledWith(U1, 'sexual_content', expect.stringContaining('admin review'));
    expect(fake.table('photo_moderation_checks').find((r) => r.id === C1)).toMatchObject({ verdict: 'explicit', model: 'admin' });
    expect(res.redirectedTo).toBe('/admin/photo-moderation?verdict=review&page=2');
  });

  it('safe: ban yok, satir safe; return_to admin disina acik yonlendirme YAPMAZ', async () => {
    const { c, fake, banUser } = await setup();
    const res = fakeRes();
    await c.action({ params: { id: C1 }, body: { action: 'safe', return_to: 'https://evil.example' }, session: {} } as never, res);
    expect(banUser).not.toHaveBeenCalled();
    expect(fake.table('photo_moderation_checks').find((r) => r.id === C1)?.verdict).toBe('safe');
    expect(res.redirectedTo).toBe('/admin/photo-moderation');
  });

  it('gecersiz id/aksiyon -> 400, bilinmeyen satir -> 404; DB\'ye dokunulmaz', async () => {
    const { c, fake, banUser } = await setup();
    const a = fakeRes();
    await c.action({ params: { id: 'x' }, body: { action: 'ban' }, session: {} } as never, a);
    expect(a.statusCode).toBe(400);
    const b = fakeRes();
    await c.action({ params: { id: C1 }, body: { action: 'delete' }, session: {} } as never, b);
    expect(b.statusCode).toBe(400);
    const d = fakeRes();
    await c.action({ params: { id: '44444444-4444-4444-8444-444444444444' }, body: { action: 'ban' }, session: {} } as never, d);
    expect(d.statusCode).toBe(404);
    expect(banUser).not.toHaveBeenCalled();
    expect(fake.table('photo_moderation_checks').find((r) => r.id === C1)?.verdict).toBe('review');
  });
});
