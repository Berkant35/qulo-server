import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sharp from 'sharp';
import { createFakeSupabase, type FakeSupabaseOptions, type Tables } from '../helpers/fake-supabase.js';

const NOW = new Date('2026-09-28T12:00:00Z');
const CAT_TH = '5a000000-0000-4000-8000-000000000001';
const CAT_ID = '5a000000-0000-4000-8000-000000000002';
const CAT_OFF = '5a000000-0000-4000-8000-000000000003';
const CAT_GONE = '5a000000-0000-4000-8000-000000000004';
const PNG = () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#3a6' } }).png().toBuffer();

const catalog = () => [
  { id: CAT_TH, brand_key: 'GRAB', country_code: 'TH', currency: 'THB', face_value: 50, is_active: true, sort_order: 0, deleted_at: null },
  { id: CAT_ID, brand_key: 'DANA', country_code: 'ID', currency: 'IDR', face_value: 10000, is_active: true, sort_order: 0, deleted_at: null },
  { id: CAT_OFF, brand_key: 'TRUEMONEY', country_code: 'TH', currency: 'THB', face_value: 20, is_active: false, sort_order: 1, deleted_at: null },
  { id: CAT_GONE, brand_key: 'LINEMAN', country_code: 'TH', currency: 'THB', face_value: 100, is_active: true, sort_order: 2, deleted_at: '2026-09-20T00:00:00Z' },
];

const sectionInput = (over: Record<string, unknown> = {}) => ({
  section_type: 'banner_carousel' as const, heading: { en: 'Deals' } as Record<string, string> | null,
  countries: null as string[] | null, platforms: null, locales: null, autoplay_seconds: 5, ...over,
});
const bannerInput = (over: Record<string, unknown> = {}) => ({
  content: { en: { title: 'Grab 50' } }, action_type: 'none' as const, action_catalog_item_id: null as string | null,
  action_route: null, countries: null, platforms: null, locales: null, is_active: true, ...over,
});
const featuredInput = (over: Record<string, unknown> = {}) => ({
  catalog_item_id: CAT_TH, countries: null, platforms: null, locales: null, is_active: true, ...over,
});
const seededSection = (over: Record<string, unknown> = {}) => ({
  id: 's1', page_key: 'rewards_market', section_type: 'banner_carousel', heading: null, sort_order: 0, status: 'draft',
  countries: null, platforms: null, locales: null, autoplay_seconds: 5, deleted_at: null, ...over,
});
const seededItem = (n: number, over: Record<string, unknown> = {}) => ({
  id: `b${n}`, section_id: 's1', sort_order: n, is_active: true, countries: null, platforms: null, locales: null,
  image_url: 'https://cdn.example/x.jpg', content: { en: { title: `t${n}` } }, action_type: 'none',
  action_catalog_item_id: null, action_route: null, catalog_item_id: null, ...over,
});

async function setup(seed: Tables = {}, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase({ page_sections: [], page_section_items: [], reward_catalog_items: catalog(), ...seed }, options);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { pageSectionsAdminService } = await import('../../src/services/page-sections-admin.service.js');
  const { pageSectionsService } = await import('../../src/services/page-sections.service.js');
  return { fake, admin: pageSectionsAdminService, reader: pageSectionsService };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('bölümler', () => {
  it('yeni bölüm taslak, sona eklenir, oluşturan kaydedilir; sayfa başına 10 sınırı', async () => {
    const { fake, admin } = await setup();
    const first = await admin.createSection('rewards_market', sectionInput(), 'adm1');
    const second = await admin.createSection('rewards_market', sectionInput({ section_type: 'featured_items' }), 'adm1');
    expect([first.status, first.sort_order, second.sort_order]).toEqual(['draft', 0, 1]);
    expect(fake.table('page_sections')[0].created_by).toBe('adm1');

    for (let i = 2; i < 10; i++) await admin.createSection('rewards_market', sectionInput(), 'adm1');
    await expect(admin.createSection('rewards_market', sectionInput(), 'adm1'))
      .rejects.toMatchObject({ code: 'PAGE_SECTION_LIMIT', params: { limit: 10 } });
  });

  it('güncelleme türü değiştirmez; hedefleme ve başlık yazılır', async () => {
    const { fake, admin } = await setup();
    const s = await admin.createSection('rewards_market', sectionInput(), 'adm1');
    await admin.updateSection(s.id, sectionInput({ section_type: 'featured_items', heading: { tr: 'Fırsatlar' }, countries: ['TH'] }));
    expect(fake.table('page_sections')[0]).toMatchObject({ section_type: 'banner_carousel', heading: { tr: 'Fırsatlar' }, countries: ['TH'] });
  });

  it('yayın ve silme okuma önbelleğini hemen düşürür; silinmiş bölüm bulunamaz', async () => {
    const { admin, reader } = await setup();
    const s = await admin.createSection('rewards_market', sectionInput(), 'adm1');
    expect((await reader.snapshot('rewards_market')).sections[0].status).toBe('draft');

    await admin.setSectionStatus(s.id, 'published');
    expect((await reader.snapshot('rewards_market')).sections[0].status).toBe('published');

    await admin.softDeleteSection(s.id);
    expect((await reader.snapshot('rewards_market')).sections).toEqual([]);
    await expect(admin.setSectionStatus(s.id, 'published')).rejects.toMatchObject({ code: 'PAGE_SECTION_NOT_FOUND' });
    expect(await admin.getSection(s.id)).toBeNull();
  });

  it('sıralama: komşuyla yer değiştirir, liste 0..n-1 numaralanır; uçta hareket etkisiz', async () => {
    const { fake, admin } = await setup({
      page_sections: [seededSection({ id: 'a', sort_order: 5 }), seededSection({ id: 'b', sort_order: 5 }), seededSection({ id: 'c', sort_order: 9 })],
    });
    await admin.moveSection('c', 'up');
    const order = () => [...fake.table('page_sections')].sort((x, y) => x.sort_order - y.sort_order).map((s) => `${s.id}${s.sort_order}`);
    expect(order()).toEqual(['a0', 'c1', 'b2']);
    await admin.moveSection('a', 'up');
    expect(order()).toEqual(['a0', 'c1', 'b2']);
  });

  it('listSections kart sayılarını ve görünmeyen hedefli kartları sayar', async () => {
    const { admin } = await setup({
      page_sections: [seededSection()],
      page_section_items: [
        seededItem(0),
        seededItem(1, { is_active: false }),
        seededItem(2, { action_type: 'catalog_item', action_catalog_item_id: CAT_OFF }),
      ],
    });
    const [summary] = await admin.listSections('rewards_market');
    expect(summary).toMatchObject({ item_count: 3, active_item_count: 2, unavailable_count: 1 });
  });
});

describe('banner kartları', () => {
  it('görsel zorunlu; JPEG\'e normalize, değişmez yol, 30 gün önbellek; okuma önbelleği düşer', async () => {
    const { fake, admin, reader } = await setup({ page_sections: [seededSection()] });
    await expect(admin.createBannerItem('s1', bannerInput(), null)).rejects.toMatchObject({ code: 'PAGE_SECTION_IMAGE_REQUIRED' });
    expect((await reader.snapshot('rewards_market')).items).toEqual([]);

    await admin.createBannerItem('s1', bannerInput(), await PNG());

    const [upload] = fake.storageUploads;
    expect(upload.bucket).toBe('assets');
    expect(upload.path).toMatch(/^page-sections\/s1\/[0-9a-f-]{36}\.jpg$/);
    expect(upload.opts).toEqual({ contentType: 'image/jpeg', cacheControl: '2592000', upsert: false });
    expect((upload.body as Buffer).subarray(0, 3).toString('hex')).toBe('ffd8ff');
    expect(fake.table('page_section_items')[0]).toMatchObject({
      section_id: 's1', sort_order: 0, is_active: true, action_type: 'none', catalog_item_id: null,
      image_url: `https://fake.supabase.co/storage/v1/object/public/assets/${upload.path}`,
    });
    expect((await reader.snapshot('rewards_market')).items).toHaveLength(1);
  });

  it('çözülemeyen görsel INVALID_FILE_TYPE: depoya ve tabloya hiçbir şey yazılmaz', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fake, admin } = await setup({ page_sections: [seededSection()] });
    await expect(admin.createBannerItem('s1', bannerInput(), Buffer.from('<html>resim degil</html>')))
      .rejects.toMatchObject({ code: 'INVALID_FILE_TYPE' });
    expect(fake.storageUploads).toEqual([]);
    expect(fake.table('page_section_items')).toEqual([]);
  });

  it('güncelleme: yeni görsel yoksa eski URL kalır', async () => {
    const { fake, admin } = await setup({ page_sections: [seededSection()], page_section_items: [seededItem(0)] });
    await admin.updateBannerItem('s1', 'b0', bannerInput({ content: { en: { title: 'Yeni' } } }), null);
    expect(fake.table('page_section_items')[0]).toMatchObject({ image_url: 'https://cdn.example/x.jpg', content: { en: { title: 'Yeni' } } });
    expect(fake.storageUploads).toEqual([]);
  });

  it('ürün hedefi: başka ülke ya da silinmiş → TARGET_INVALID; pasif kabul edilir ve rozetlenir', async () => {
    const { admin } = await setup({ page_sections: [seededSection({ countries: ['TH'] })] });
    const png = await PNG();
    await expect(admin.createBannerItem('s1', bannerInput({ action_type: 'catalog_item', action_catalog_item_id: CAT_ID }), png))
      .rejects.toMatchObject({ code: 'PAGE_SECTION_TARGET_INVALID' });
    await expect(admin.createBannerItem('s1', bannerInput({ action_type: 'catalog_item', action_catalog_item_id: CAT_GONE }), png))
      .rejects.toMatchObject({ code: 'PAGE_SECTION_TARGET_INVALID' });

    await admin.createBannerItem('s1', bannerInput({ action_type: 'catalog_item', action_catalog_item_id: CAT_OFF }), png);
    const found = await admin.getSection('s1');
    expect(found?.items.map((i) => i.target_unavailable)).toEqual([true]);
  });

  it('carousel en çok 8 aktif kart: 9. aktif reddedilir (görsel yüklenmeden), pasif kabul, sonra aktifleştirme reddedilir', async () => {
    const { fake, admin } = await setup({
      page_sections: [seededSection()],
      page_section_items: Array.from({ length: 8 }, (_, n) => seededItem(n)),
    });
    const png = await PNG();
    await expect(admin.createBannerItem('s1', bannerInput(), png)).rejects.toMatchObject({ code: 'PAGE_SECTION_ITEM_LIMIT', params: { limit: 8 } });
    expect(fake.storageUploads).toEqual([]);

    await admin.createBannerItem('s1', bannerInput({ is_active: false }), png);
    const nineth = fake.table('page_section_items').find((i) => i.is_active === false)!;
    await expect(admin.setItemActive('s1', nineth.id, true)).rejects.toMatchObject({ code: 'PAGE_SECTION_ITEM_LIMIT' });

    await admin.setItemActive('s1', 'b0', false);
    await admin.setItemActive('s1', nineth.id, true);
    expect(fake.table('page_section_items').filter((i) => i.is_active)).toHaveLength(8);
  });

  it('yanlış türdeki bölüme kart eklenemez', async () => {
    const { admin } = await setup({ page_sections: [seededSection()] });
    await expect(admin.createFeaturedItem('s1', featuredInput())).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('öne çıkanlar + ortak kart işlemleri', () => {
  it('öne çıkan ürün: en çok 12 aktif; ülke dışı ürün reddedilir', async () => {
    const { admin } = await setup({
      page_sections: [seededSection({ section_type: 'featured_items', countries: ['TH'] })],
      page_section_items: Array.from({ length: 12 }, (_, n) => seededItem(n, { image_url: null, content: null, catalog_item_id: CAT_TH })),
    });
    await expect(admin.createFeaturedItem('s1', featuredInput())).rejects.toMatchObject({ code: 'PAGE_SECTION_ITEM_LIMIT', params: { limit: 12 } });
    await expect(admin.createFeaturedItem('s1', featuredInput({ catalog_item_id: CAT_ID, is_active: false })))
      .rejects.toMatchObject({ code: 'PAGE_SECTION_TARGET_INVALID' });
    await admin.createFeaturedItem('s1', featuredInput({ is_active: false }));
  });

  it('yeni kart en büyük sort_order\'ın arkasına eklenir (kardeşler DB\'de karışık sırada olsa da)', async () => {
    const featuredRow = (n: number, sort: number) => seededItem(n, { image_url: null, content: null, catalog_item_id: CAT_TH, sort_order: sort });
    const { fake, admin } = await setup({
      page_sections: [seededSection({ section_type: 'featured_items' })],
      page_section_items: [featuredRow(0, 0), featuredRow(1, 7), featuredRow(2, 3)],
    });
    await admin.createFeaturedItem('s1', featuredInput({ is_active: false }));
    expect(fake.table('page_section_items').at(-1)).toMatchObject({ catalog_item_id: CAT_TH, is_active: false, sort_order: 8 });
  });

  it('kart sıralama ve silme; başka bölümün kartı bulunamaz', async () => {
    const { fake, admin, reader } = await setup({
      page_sections: [seededSection(), seededSection({ id: 's2', sort_order: 1 })],
      page_section_items: [seededItem(0), seededItem(1), seededItem(9, { section_id: 's2' })],
    });
    await admin.moveItem('s1', 'b1', 'up');
    expect(fake.table('page_section_items').filter((i) => i.section_id === 's1').sort((a, b) => a.sort_order - b.sort_order).map((i) => i.id)).toEqual(['b1', 'b0']);

    await expect(admin.setItemActive('s1', 'b9', false)).rejects.toMatchObject({ code: 'PAGE_SECTION_NOT_FOUND' });

    await reader.snapshot('rewards_market');
    await admin.deleteItem('s1', 'b0');
    expect(fake.table('page_section_items').map((i) => i.id)).toEqual(['b1', 'b9']);
    expect((await reader.snapshot('rewards_market')).items.map((i) => i.id)).toEqual(['b1', 'b9']);
  });

  it('katalog seçenekleri: silinmemiş (pasif dahil) ve bölüm ülkelerine süzülü', async () => {
    const { admin } = await setup();
    expect((await admin.catalogOptions(['TH'])).map((o) => o.id)).toEqual([CAT_TH, CAT_OFF]);
    expect((await admin.catalogOptions(null)).map((o) => o.id)).toEqual([CAT_ID, CAT_TH, CAT_OFF]);
  });
});

describe('okuma önbelleği — kalan yazım yolları', () => {
  type Admin = Awaited<ReturnType<typeof setup>>['admin'];
  type Snapshot = Awaited<ReturnType<Awaited<ReturnType<typeof setup>>['reader']['snapshot']>>;
  const item = (snap: Snapshot, id: string) => snap.items.find((i) => i.id === id)!;
  const section = (snap: Snapshot, id: string) => snap.sections.find((x) => x.id === id)!;

  // Her satır: önbellek ısınmışken tek yazım → bir sonraki snapshot değişikliği görmeli (yeniden okuma).
  const cases: Array<[string, (admin: Admin) => Promise<void>, (snap: Snapshot) => unknown, unknown]> = [
    ['setItemActive', (a) => a.setItemActive('s1', 'b0', false), (snap) => item(snap, 'b0').is_active, false],
    [
      'updateBannerItem',
      (a) => a.updateBannerItem('s1', 'b0', bannerInput({ content: { en: { title: 'Yeni' } } }), null),
      (snap) => item(snap, 'b0').content?.en?.title,
      'Yeni',
    ],
    [
      'updateFeaturedItem',
      (a) => a.updateFeaturedItem('s2', 'f0', featuredInput({ catalog_item_id: CAT_OFF })),
      (snap) => item(snap, 'f0').catalog_item_id,
      CAT_OFF,
    ],
    ['moveSection', (a) => a.moveSection('s2', 'up'), (snap) => section(snap, 's2').sort_order, 0],
    ['moveItem', (a) => a.moveItem('s1', 'b1', 'up'), (snap) => item(snap, 'b1').sort_order, 0],
  ];

  it.each(cases)('%s sonrası bir sonraki snapshot değişikliği görür', async (_name, act, read, expected) => {
    const { admin, reader } = await setup({
      page_sections: [seededSection(), seededSection({ id: 's2', section_type: 'featured_items', sort_order: 1 })],
      page_section_items: [
        seededItem(0),
        seededItem(1),
        seededItem(0, { id: 'f0', section_id: 's2', image_url: null, content: null, catalog_item_id: CAT_TH }),
      ],
    });
    const before = await reader.snapshot('rewards_market');
    expect(read(before)).not.toEqual(expected);

    await act(admin);

    expect(read(await reader.snapshot('rewards_market'))).toEqual(expected);
  });
});
