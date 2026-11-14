import { describe, it, expect, beforeEach, vi } from 'vitest';
import ejs from 'ejs';
import { join } from 'node:path';
import { createFakeSupabase, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';

/**
 * Backoffice kullanıcı detayı → fotoğrafı doğrudan profilden kaldırma (2026-11-14).
 * Form `urlencoded({ extended: false })` ile gelir: tek seçim string, çoklu seçim dizi.
 * Gerçek servis + fake Supabase: controller'ın gerçekten profili değiştirdiği kanıtlanır.
 */
const U1 = '11111111-1111-4111-8111-111111111111';
const BASE = 'https://fake.supabase.co/storage/v1/object/public/photos/';
const url = (n: number) => `${BASE}${U1}/${n}.jpg`;
const SESSION = { adminId: 'adm1', adminRole: 'ADMIN', adminEmail: 'mod@qulo.test', csrfToken: 'tok' };

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

async function setup(
  photos: string[] = [url(1), url(2), url(3)],
  userExtra: Record<string, unknown> = {},
  options: FakeSupabaseOptions = {},
) {
  const fake = createFakeSupabase(
    { users: [{ id: U1, photos, is_deleted: false, ...userExtra }], user_details: [], questions: [], swipes: [] },
    { storage: { photos: [`${U1}/1.jpg`, `${U1}/2.jpg`, `${U1}/3.jpg`] }, ...options },
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { userPhotosAdminController } = await import('../../src/admin/user-photos.admin.controller.js');
  const { adminController } = await import('../../src/admin/admin.controller.js');
  return { fake, c: userPhotosAdminController, adminController, photosOf: () => fake.table('users')[0].photos as string[] };
}

const istek = (urls: unknown, id: string = U1) => ({ params: { id }, body: { urls }, session: SESSION, query: {} }) as never;

beforeEach(() => vi.resetModules());

describe('userPhotosAdminController.remove', () => {
  it('tek seçim (string) → fotoğraf kalkar, detaya geri döner', async () => {
    const { c, photosOf } = await setup();
    const res = fakeRes();
    await c.remove(istek(url(2)), res);
    expect(res.redirectedTo).toBe(`/admin/users/${U1}`);
    expect(photosOf()).toEqual([url(1), url(3)]);
  });

  it('çoklu seçim (dizi) → hepsi tek istekte kalkar; tekrar eden ve string olmayan değer elenir', async () => {
    const { c, photosOf } = await setup();
    const res = fakeRes();
    await c.remove(istek([url(1), url(1), { x: 1 }, url(3)]), res);
    expect(res.redirectedTo).toBe(`/admin/users/${U1}`);
    expect(photosOf()).toEqual([url(2)]);
  });

  it.each([
    ['seçim yok', undefined],
    ['boş string', ''],
    ['6\'dan fazla', Array.from({ length: 7 }, (_, i) => url(i + 10))],
  ])('%s → ?error=photo_selection, profil değişmez', async (_ad, urls) => {
    const { c, photosOf } = await setup();
    const res = fakeRes();
    await c.remove(istek(urls), res);
    expect(res.redirectedTo).toBe(`/admin/users/${U1}?error=photo_selection`);
    expect(photosOf()).toEqual([url(1), url(2), url(3)]);
  });

  it('bayat sayfa (URL artık profilde değil) → ?error=photo_not_found', async () => {
    const { c, photosOf } = await setup([url(1)]);
    const res = fakeRes();
    await c.remove(istek(url(2)), res);
    expect(res.redirectedTo).toBe(`/admin/users/${U1}?error=photo_not_found`);
    expect(photosOf()).toEqual([url(1)]);
  });

  it('silinmiş hesap → ?error=user_not_found (beklenen durum, hata logu yok), profil değişmez', async () => {
    const { c, photosOf } = await setup([url(1)], { is_deleted: true });
    const logErr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = fakeRes();
    await c.remove(istek(url(1)), res);
    expect(res.redirectedTo).toBe(`/admin/users/${U1}?error=user_not_found`);
    expect(logErr).not.toHaveBeenCalled();
    expect(photosOf()).toEqual([url(1)]);
    logErr.mockRestore();
  });

  it('kullanıcı aynı anda fotoğraf değiştirdi → ?error=photos_changed, yeni hali korunur', async () => {
    const { c, photosOf } = await setup([url(1), url(2)], {}, {
      interleave: [{ table: 'users', mutate: (rows) => { rows[0].photos = [url(2), url(1)]; } }],
    });
    const res = fakeRes();
    await c.remove(istek(url(1)), res);
    expect(res.redirectedTo).toBe(`/admin/users/${U1}?error=photos_changed`);
    expect(photosOf()).toEqual([url(2), url(1)]);
  });

  it('beklenmeyen hata → ?error=action_failed (askıda istek yok)', async () => {
    const { c } = await setup([url(1)], {}, { failOn: [{ table: 'users', op: 'update' }] });
    const logErr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = fakeRes();
    await c.remove(istek(url(1)), res);
    expect(res.redirectedTo).toBe(`/admin/users/${U1}?error=action_failed`);
    expect(logErr).toHaveBeenCalled();
    logErr.mockRestore();
  });

  it.each(['abc', "1' or '1'='1", '../x'])('geçersiz :id %j → 400, id URL\'ye yansımaz', async (badId) => {
    const { c, photosOf } = await setup();
    const res = fakeRes();
    await c.remove(istek(url(1), badId), res);
    expect(res.statusCode).toBe(400);
    expect(res.redirectedTo).toBeNull();
    expect(photosOf()).toEqual([url(1), url(2), url(3)]);
  });

  it('hata kodları detay sayfasında Türkçe mesaja çevrilir', async () => {
    const { adminController } = await setup();
    for (const [kod, beklenen] of [
      ['photo_selection', /1–6 fotoğraf/],
      ['photo_not_found', /artık profilde değil/],
      ['photos_changed', /bu sırada fotoğraflarını değiştirdi/],
      ['user_not_found', /bulunamadı ya da hesabı silinmiş/],
    ] as const) {
      const res = fakeRes();
      await adminController.userDetail({ params: { id: U1 }, query: { error: kod }, session: SESSION } as never, res);
      expect(res.rendered.locals.error).toMatch(beklenen);
    }
  });
});

describe('admin.routes — kaldırma rotasının güvenlik dizilimi', () => {
  type Layer = { name: string; handle: unknown; route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } };

  it('POST /users/:id/photos/remove: csrfValidate rotada, adminAuth rotadan ÖNCE router seviyesinde', async () => {
    vi.doMock('../../src/config/supabase.js', () => ({ supabase: createFakeSupabase().client }));
    const { default: router } = await import('../../src/admin/admin.routes.js');
    const { csrfValidate, adminAuth } = await import('../../src/admin/admin.middleware.js');
    const stack = (router as unknown as { stack: Layer[] }).stack;
    const routeIndex = stack.findIndex((l) => l.route?.path === '/users/:id/photos/remove' && l.route.methods.post);
    expect(routeIndex).toBeGreaterThan(-1);
    expect(stack[routeIndex].route!.stack.map((l) => l.handle)).toContain(csrfValidate);
    const authIndex = stack.findIndex((l) => !l.route && l.handle === adminAuth);
    expect(authIndex).toBeGreaterThan(-1);
    expect(authIndex).toBeLessThan(routeIndex);
  });
});

describe('user-detail görünümü — fotoğraf kaldırma kontrolleri', () => {
  const VIEWS = join(process.cwd(), 'src', 'admin', 'views');
  const render = (user: Record<string, unknown>) => ejs.renderFile(join(VIEWS, 'user-detail.ejs'), {
    user: { id: U1, created_at: '2026-11-01T00:00:00Z', ...user },
    details: null, questions: [], swipeCount: 0, error: null, session: SESSION, csrfToken: 'tok',
  });

  it('her fotoğrafta Kaldır formu + toplu seçim kutusu; csrf ve onay diyaloğu var', async () => {
    const html = await render({ photos: [url(1), url(2)], is_deleted: false });
    expect(html.match(new RegExp(`action="/admin/users/${U1}/photos/remove"`, 'g'))).toHaveLength(3); // toplu + 2 tekil
    expect(html).toContain(`value="${url(2)}" form="photo-remove-bulk"`);
    expect(html).toContain('name="_csrf" value="tok"');
    expect(html).toContain('confirm(');
    expect(html).toContain('Ana');
  });

  it('silinmiş hesapta kaldırma kontrolleri gösterilmez, fotoğraflar görünür', async () => {
    const html = await render({ photos: [url(1)], is_deleted: true });
    expect(html).not.toContain('/photos/remove');
    expect(html).toContain(`src="${url(1)}"`);
  });

  it('https olmayan URL tam boyut bağlantısına dönüşmez', async () => {
    const html = await render({ photos: ['javascript:alert(1)'], is_deleted: false });
    expect(html).not.toContain('href="javascript:');
  });
});
