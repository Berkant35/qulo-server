import { describe, it, expect, beforeEach, vi } from 'vitest';
import ejs from 'ejs';
import { join } from 'node:path';
import { createFakeSupabase } from '../helpers/fake-supabase.js';
import { buildPagination } from '../../src/admin/utils/pagination.js';

const VIEWS = join(process.cwd(), 'src', 'admin', 'views');

const FORM = { app_version: '2.2.0', platform: 'all', title_en: 'New', body_en: 'Body', is_active: 'on' };

async function load(rows: any[] = []) {
  const fake = createFakeSupabase({ whats_new: rows });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const ctrl = await import('../../src/admin/whats-new.admin.controller.js');
  return { fake, ...ctrl };
}

function reqRes(body: Record<string, unknown> = {}, params: Record<string, string> = {}) {
  const req: any = { body, params, query: {}, session: { adminId: 'adm-1', csrfToken: 't' } };
  const res: any = { redirected: '', redirect(u: string) { res.redirected = u; return res; } };
  return { req, res };
}

beforeEach(() => vi.resetModules());

describe('parseWhatsNewForm — admin doğrulaması', () => {
  it('yalnız EN dolu geçerli form kabul edilir', async () => {
    const { parseWhatsNewForm } = await load();
    const r = parseWhatsNewForm(FORM);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ is_active: true, image_url: null, content: { en: { title: 'New' } } });
  });

  it('EN boşsa reddedilir (başka dil dolu olsa da)', async () => {
    const { parseWhatsNewForm } = await load();
    const { title_en, body_en, ...rest } = FORM;
    expect(parseWhatsNewForm({ ...rest, title_tr: 'Yeni', body_tr: 'Metin' }).success).toBe(false);
  });

  it('http görsel reddedilir', async () => {
    const { parseWhatsNewForm } = await load();
    expect(parseWhatsNewForm({ ...FORM, image_url: 'http://x.com/a.png' }).success).toBe(false);
    expect(parseWhatsNewForm({ ...FORM, image_url: 'https://x.com/a.png' }).success).toBe(true);
  });

  it('uzunluk sınırları form üzerinden de uygulanır', async () => {
    const { parseWhatsNewForm } = await load();
    expect(parseWhatsNewForm({ ...FORM, title_en: 'a'.repeat(61) }).success).toBe(false);
    expect(parseWhatsNewForm({ ...FORM, body_en: 'a'.repeat(401) }).success).toBe(false);
    expect(parseWhatsNewForm({ ...FORM, cta_en: 'a'.repeat(25) }).success).toBe(false);
  });

  it('yarım dil (başlık var metin yok) reddedilir; aktif kutusu işaretsizse false', async () => {
    const { parseWhatsNewForm } = await load();
    expect(parseWhatsNewForm({ ...FORM, title_tr: 'Yeni' }).success).toBe(false);
    const r = parseWhatsNewForm({ ...FORM, is_active: undefined });
    expect(r.success && r.data.is_active).toBe(false);
  });
});

describe('whatsNewAdminController', () => {
  it('geçerli create kaydı yazar, created_by = oturumdaki admin', async () => {
    const { whatsNewAdminController, fake } = await load();
    const { req, res } = reqRes(FORM);
    await whatsNewAdminController.create(req, res);
    expect(res.redirected).toBe('/admin/whats-new');
    expect(fake.table('whats_new')).toHaveLength(1);
    expect(fake.table('whats_new')[0]).toMatchObject({ created_by: 'adm-1', app_version: '2.2.0' });
  });

  it('geçersiz create yazmaz, hatayı oturuma koyup forma döner', async () => {
    const { whatsNewAdminController, fake } = await load();
    const { req, res } = reqRes({ ...FORM, title_en: '' });
    await whatsNewAdminController.create(req, res);
    expect(res.redirected).toBe('/admin/whats-new/new');
    expect(req.session.whatsNewError).toBeTruthy();
    expect(fake.table('whats_new')).toHaveLength(0);
  });

  it('toggle durumu çevirir', async () => {
    const { whatsNewAdminController, fake } = await load([
      { id: 'a', app_version: '2.2.0', platform: 'all', content: { en: {} }, image_url: null, is_active: true },
    ]);
    const { req, res } = reqRes({}, { id: 'a' });
    await whatsNewAdminController.toggle(req, res);
    expect(fake.table('whats_new')[0].is_active).toBe(false);
  });
});

describe('admin yetki ve CSRF', () => {
  it('adminAuth oturumsuz isteği girişe yönlendirir, handler çalışmaz', async () => {
    const { adminAuth } = await import('../../src/admin/admin.middleware.js');
    const res: any = { redirect: vi.fn() };
    const next = vi.fn();
    adminAuth({ session: {} } as any, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/admin/login');
    expect(next).not.toHaveBeenCalled();
  });

  it('yenilikler rotaları adminAuth ARKASINDA, POST\'lar csrfValidate\'li', async () => {
    vi.doMock('../../src/config/supabase.js', () => ({ supabase: createFakeSupabase().client }));
    const { default: router } = await import('../../src/admin/admin.routes.js');
    const { adminAuth, csrfValidate } = await import('../../src/admin/admin.middleware.js');
    const stack = (router as any).stack as any[];
    const authIdx = stack.findIndex((l) => l.handle === adminAuth);
    const wn = stack.map((l, i) => ({ l, i })).filter(({ l }) => l.route?.path?.startsWith('/whats-new'));
    expect(authIdx).toBeGreaterThan(-1);
    expect(wn.length).toBe(6);
    for (const { l, i } of wn) {
      expect(i).toBeGreaterThan(authIdx);
      if (l.route.methods.post) expect(l.route.stack.map((s: any) => s.handle)).toContain(csrfValidate);
    }
  });
});

describe('görünümler', () => {
  const locals = { session: { adminRole: 'SUPER_ADMIN' }, csrfToken: 't', buildPagination };

  it('liste: sürüm, platform, durum ve dil doluluğu', async () => {
    const html = await ejs.renderFile(join(VIEWS, 'whats-new-list.ejs'), {
      ...locals, error: null, page: 1, totalPages: 1, total: 1, localeTotal: 18,
      items: [{ id: 'a', app_version: '2.2.0', platform: 'ios', is_active: true, localeCount: 3, updated_at: null }],
    });
    expect(html).toContain('2.2.0');
    expect(html).toContain('3 / 18');
    expect(html).toContain('/admin/whats-new/a/toggle');
  });

  it('form: 18 dilin alanları ve CSRF alanı', async () => {
    const { whatsNewAdminController } = await load();
    let model: any;
    const res: any = { render: (_v: string, m: unknown) => { model = m; } };
    const { req } = reqRes();
    await whatsNewAdminController.newForm(req, res);
    const html: string = await ejs.renderFile(join(VIEWS, 'whats-new-edit.ejs'), { ...locals, ...model });
    expect((html.match(/name="title_/g) ?? []).length).toBe(18);
    expect(html).toContain('name="_csrf"');
  });
});
