import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function fakeRes() {
  const res: any = {
    statusCode: 200,
    rendered: null as null | { view: string; locals: any },
    redirectedTo: null as string | null,
    status(code: number) { res.statusCode = code; return res; },
    render(view: string, locals: any) { res.rendered = { view, locals }; return res; },
    redirect(url: string) { res.redirectedTo = url; return res; },
  };
  return res;
}

const SID = '6b3f2a1e-9c4d-4e5f-8a7b-1c2d3e4f5a6b';
const IID = '7c4a3b2f-0d5e-4f6a-9b8c-2d3e4f5a6b7c';
const CAT = '5a000000-0000-4000-8000-000000000001';

const req = (over: Record<string, unknown> = {}) =>
  ({ params: {}, query: {}, body: {}, session: { adminId: 'adm1', adminRole: 'SUPER_ADMIN', csrfToken: 't' }, ...over }) as any;

const bannerSection = { id: SID, page_key: 'rewards_market', section_type: 'banner_carousel', heading: { en: 'Deals' }, sort_order: 0, status: 'draft', countries: ['TH'], platforms: null, locales: null, autoplay_seconds: 5, created_at: '2026-09-28T00:00:00Z', updated_at: null };
const bannerItem = { id: IID, section_id: SID, sort_order: 0, is_active: true, countries: null, platforms: ['android'], locales: null, image_url: 'https://cdn.example/b.jpg', content: { en: { title: 'Grab 50' } }, action_type: 'catalog_item', action_catalog_item_id: CAT, action_route: null, catalog_item_id: null, created_at: '2026-09-28T00:00:00Z', updated_at: null, target_unavailable: false };

async function setup(over: Record<string, unknown> = {}, statsImpl?: () => Promise<Map<string, unknown>>) {
  const { AppError } = await import('../../src/utils/errors.js');
  const admin = {
    listSections: vi.fn(async () => [{ ...bannerSection, item_count: 2, active_item_count: 1, unavailable_count: 1 }]),
    getSection: vi.fn(async () => ({ section: bannerSection, items: [bannerItem] })),
    catalogOptions: vi.fn(async () => [{ id: CAT, brand_key: 'GRAB', country_code: 'TH', currency: 'THB', face_value: 50, is_active: true }]),
    createSection: vi.fn(async () => ({ ...bannerSection })),
    updateSection: vi.fn(async () => {}),
    setSectionStatus: vi.fn(async () => {}),
    softDeleteSection: vi.fn(async () => {}),
    moveSection: vi.fn(async () => {}),
    createBannerItem: vi.fn(async () => {}),
    updateBannerItem: vi.fn(async () => {}),
    createFeaturedItem: vi.fn(async () => {}),
    updateFeaturedItem: vi.fn(async () => {}),
    setItemActive: vi.fn(async () => {}),
    moveItem: vi.fn(async () => {}),
    deleteItem: vi.fn(async () => {}),
    ...over,
  };
  const stats = vi.fn(statsImpl ?? (async () => new Map([[IID, { impressions: 10, clicks: 3, redemptions: 1, breakdown: [{ country: 'TH', platform: 'android', impressions: 10, clicks: 3, redemptions: 1 }] }]])));
  vi.doMock('../../src/services/page-sections-admin.service.js', () => ({ pageSectionsAdminService: admin }));
  vi.doMock('../../src/services/page-section-events.service.js', () => ({ pageSectionEventsService: { stats } }));
  vi.doMock('../../src/services/rewards-catalog-admin.service.js', () => ({
    rewardsCatalogAdminService: { listCountries: vi.fn(async () => [{ country_code: 'TH', currency: 'THB', enabled: false, android_enabled: true, ios_enabled: false, updated_at: null }]) },
  }));
  const mod = await import('../../src/admin/page-sections.admin.controller.js');
  const view = await import('../../src/admin/page-sections.admin.view.js');
  return { ...mod, ...view, admin, stats, AppError };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pageSectionsAdminController — bölümler', () => {
  it('liste hedefleme özetiyle çizilir; bilinmeyen/prototip ?error= gösterilmez', async () => {
    const { pageSectionsAdminController: c } = await setup();
    const res = fakeRes();
    await c.list(req({ query: { error: 'constructor', notice: 'published' } }), res);
    expect(res.rendered.view).toBe('rewards-sections-list');
    expect(res.rendered.locals.sections[0].targeting).toBe('TH · tüm platformlar · tüm diller');
    expect(res.rendered.locals.error).toBeNull();
    expect(res.rendered.locals.notice).toContain('Yayınlandı');
  });

  it('oluşturma: geçersiz form 400 + girilen değerler; geçerli form oluşturup bölüm sayfasına yönlendirir', async () => {
    const { pageSectionsAdminController: c, admin } = await setup();
    const bad = fakeRes();
    await c.create(req({ body: { section_type: 'hero', heading_en: 'x' } }), bad);
    expect(bad.statusCode).toBe(400);
    expect(bad.rendered.view).toBe('rewards-section-edit');
    expect(bad.rendered.locals.form).toMatchObject({ heading_en: 'x' });
    expect(admin.createSection).not.toHaveBeenCalled();

    const ok = fakeRes();
    await c.create(req({ body: { section_type: 'banner_carousel', heading_en: 'Deals', countries: 'TH' } }), ok);
    expect(admin.createSection).toHaveBeenCalledWith('rewards_market', expect.objectContaining({ heading: { en: 'Deals' }, countries: ['TH'] }), 'adm1');
    expect(ok.redirectedTo).toBe(`/admin/rewards/sections/${SID}?notice=saved`);
  });

  it('sınır aşımı formu mesajla yeniden gösterir', async () => {
    const { AppError } = await import('../../src/utils/errors.js');
    const { pageSectionsAdminController: c } = await setup({
      createSection: vi.fn(async () => { throw new AppError('PAGE_SECTION_LIMIT', 400, 'x', { limit: 10 }); }),
    });
    const res = fakeRes();
    await c.create(req({ body: { section_type: 'banner_carousel' } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.rendered.locals.error).toContain('en fazla 10 bölüm');
  });

  it('düzenleme: uuid olmayan :id servise gitmez; kartlar etiket + istatistikle; ?days=30', async () => {
    const { pageSectionsAdminController: c, admin, stats } = await setup();
    const bad = fakeRes();
    await c.edit(req({ params: { id: 'nope' } }), bad);
    expect(bad.redirectedTo).toBe('/admin/rewards/sections?error=not_found');
    expect(admin.getSection).not.toHaveBeenCalled();

    const res = fakeRes();
    await c.edit(req({ params: { id: SID }, query: { days: '30' } }), res);
    expect(stats).toHaveBeenCalledWith('rewards_market', 30);
    const [item] = res.rendered.locals.items;
    expect(item).toMatchObject({ label: 'Grab 50', targeting: 'tüm ülkeler · Android · tüm diller', stats: { impressions: 10, clicks: 3, redemptions: 1 } });
    expect(res.rendered.locals.days).toBe(30);
  });

  it('istatistik okunamazsa sayfa yine açılır (uyarıyla)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { pageSectionsAdminController: c } = await setup({}, async () => { throw new Error('rpc down'); });
    const res = fakeRes();
    await c.edit(req({ params: { id: SID } }), res);
    expect(res.rendered.view).toBe('rewards-section-edit');
    expect(res.rendered.locals.statsError).toBeTruthy();
    expect(res.rendered.locals.items[0].stats.impressions).toBe(0);
  });

  it('yayın/taslak: geçersiz durum invalid_input; geçerli durum bildirimle döner', async () => {
    const { pageSectionsAdminController: c, admin } = await setup();
    const bad = fakeRes();
    await c.status(req({ params: { id: SID }, body: { status: 'live' } }), bad);
    expect(bad.redirectedTo).toBe('/admin/rewards/sections?error=invalid_input');

    const pub = fakeRes();
    await c.status(req({ params: { id: SID }, body: { status: 'published' } }), pub);
    expect(admin.setSectionStatus).toHaveBeenCalledWith(SID, 'published');
    expect(pub.redirectedTo).toBe('/admin/rewards/sections?notice=published');

    const draft = fakeRes();
    await c.status(req({ params: { id: SID }, body: { status: 'draft' } }), draft);
    expect(draft.redirectedTo).toBe('/admin/rewards/sections?notice=drafted');
  });
});

describe('pageSectionsAdminController — kartlar', () => {
  it('banner kartı: dosya tamponu servise gider; görsel yoksa servis hatası formda gösterilir', async () => {
    const { AppError } = await import('../../src/utils/errors.js');
    const created = vi.fn(async () => { throw new AppError('PAGE_SECTION_IMAGE_REQUIRED', 400, 'x'); });
    const { pageSectionsAdminController: c } = await setup({ createBannerItem: created });

    const res = fakeRes();
    await c.itemCreate(req({ params: { id: SID }, body: { title_en: 'Grab', action_type: 'none', is_active: 'on' } }), res);
    expect(created).toHaveBeenCalledWith(SID, expect.objectContaining({ content: { en: { title: 'Grab' } } }), null);
    expect(res.statusCode).toBe(400);
    expect(res.rendered.view).toBe('rewards-section-item-edit');
    expect(res.rendered.locals.error).toContain('görseli zorunlu');
  });

  it('banner kartı dosyayla oluşturulur ve bölüm sayfasına döner', async () => {
    const { pageSectionsAdminController: c, admin } = await setup();
    const file = { buffer: Buffer.from('img') };
    const res = fakeRes();
    await c.itemCreate(req({ params: { id: SID }, body: { title_en: 'Grab', action_type: 'none' }, file }), res);
    expect(admin.createBannerItem).toHaveBeenCalledWith(SID, expect.anything(), file.buffer);
    expect(res.redirectedTo).toBe(`/admin/rewards/sections/${SID}?notice=saved`);
  });

  it('öne çıkan bölümde ürün formu kullanılır; geçersiz form 400', async () => {
    const featuredSection = { ...bannerSection, section_type: 'featured_items' };
    const { pageSectionsAdminController: c, admin } = await setup({
      getSection: vi.fn(async () => ({ section: featuredSection, items: [] })),
    });
    const bad = fakeRes();
    await c.itemCreate(req({ params: { id: SID }, body: { catalog_item_id: 'x' } }), bad);
    expect(bad.statusCode).toBe(400);

    const ok = fakeRes();
    await c.itemCreate(req({ params: { id: SID }, body: { catalog_item_id: CAT, is_active: 'on' } }), ok);
    expect(admin.createFeaturedItem).toHaveBeenCalledWith(SID, expect.objectContaining({ catalog_item_id: CAT, is_active: true }));
  });

  it('kart aktif/pasif ve silme bölüm sayfasına döner; uuid olmayan kart id servise gitmez', async () => {
    const { pageSectionsAdminController: c, admin } = await setup();
    const on = fakeRes();
    await c.itemActive(req({ params: { id: SID, itemId: IID }, body: { active: '1' } }), on);
    expect(admin.setItemActive).toHaveBeenCalledWith(SID, IID, true);
    expect(on.redirectedTo).toBe(`/admin/rewards/sections/${SID}?notice=saved`);

    const bad = fakeRes();
    await c.itemDelete(req({ params: { id: SID, itemId: 'x' } }), bad);
    expect(admin.deleteItem).not.toHaveBeenCalled();
    expect(bad.redirectedTo).toBe('/admin/rewards/sections?error=not_found');
  });

  it('kart formu ürün seçeneklerini etiketli verir (görünüm etiketi yeniden kurmaz)', async () => {
    const { pageSectionsAdminController: c, admin } = await setup({
      catalogOptions: vi.fn(async () => [
        { id: CAT, brand_key: 'GRAB', country_code: 'TH', currency: 'THB', face_value: 50, is_active: true },
        { id: 'c-off', brand_key: 'TRUEMONEY', country_code: 'TH', currency: 'THB', face_value: 20, is_active: false },
      ]),
    });
    const res = fakeRes();
    await c.itemNew(req({ params: { id: SID } }), res);
    expect(admin.catalogOptions).toHaveBeenCalledWith(['TH']);
    expect(res.rendered.locals.options.map((o: { label: string }) => o.label)).toEqual([
      'GRAB · TH · 50 THB',
      'TRUEMONEY · TH · 20 THB (pasif)',
    ]);
  });

  it('hata kodu eşlemesi; beklenmeyen hata loglanıp failed olur', async () => {
    const { sectionsErrorCode, AppError } = await setup();
    expect(sectionsErrorCode(new AppError('INVALID_FILE_TYPE', 400), 'x')).toBe('image_invalid');
    expect(sectionsErrorCode(new AppError('PAGE_SECTION_ITEM_LIMIT', 400), 'x')).toBe('item_limit');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(sectionsErrorCode(new Error('boom'), 'ctx')).toBe('failed');
    expect(spy).toHaveBeenCalled();
  });
});
