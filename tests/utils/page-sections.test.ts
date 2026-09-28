import { describe, it, expect } from 'vitest';
import {
  matchesTargeting,
  pickLocalized,
  resolveSections,
  toTargetPlatform,
  SECTION_LIMITS,
  type SectionItemRow,
  type SectionRow,
  type ViewerContext,
} from '../../src/utils/page-sections.js';

type Item = { id: string; country_code: string };
const catalog = new Map<string, Item>([
  ['c-grab-th', { id: 'c-grab-th', country_code: 'TH' }],
  ['c-dana-id', { id: 'c-dana-id', country_code: 'ID' }],
]);

const ctx = (over: Partial<ViewerContext> = {}): ViewerContext => ({
  country: 'TH', platform: 'android', locale: 'th', isTestAdmin: false, ...over,
});

const section = (over: Partial<SectionRow> = {}): SectionRow => ({
  id: 's1', page_key: 'rewards_market', section_type: 'banner_carousel', heading: { en: 'Deals', th: 'ดีล' },
  sort_order: 0, status: 'published', countries: null, platforms: null, locales: null, autoplay_seconds: 5,
  ...over,
});

const banner = (over: Partial<SectionItemRow> = {}): SectionItemRow => ({
  id: 'b1', section_id: 's1', sort_order: 0, is_active: true, countries: null, platforms: null, locales: null,
  image_url: 'https://cdn.example/b1.jpg', content: { en: { title: 'Grab 50', subtitle: 'Ride', cta_label: 'Get' } },
  action_type: 'catalog_item', action_catalog_item_id: 'c-grab-th', action_route: null, catalog_item_id: null,
  ...over,
});

const featured = (over: Partial<SectionItemRow> = {}): SectionItemRow => ({
  id: 'f1', section_id: 's2', sort_order: 0, is_active: true, countries: null, platforms: null, locales: null,
  image_url: null, content: null, action_type: 'none', action_catalog_item_id: null, action_route: null,
  catalog_item_id: 'c-grab-th', ...over,
});

describe('toTargetPlatform', () => {
  it('ios/android geçer, web ve yok → null', () => {
    expect(toTargetPlatform('ios')).toBe('ios');
    expect(toTargetPlatform('android')).toBe('android');
    expect(toTargetPlatform('web')).toBeNull();
    expect(toTargetPlatform(undefined)).toBeNull();
  });
});

describe('matchesTargeting', () => {
  const none = { countries: null, platforms: null, locales: null };

  it('NULL ve boş dizi = hepsi', () => {
    expect(matchesTargeting(none, ctx())).toBe(true);
    expect(matchesTargeting({ countries: [], platforms: [], locales: [] }, ctx())).toBe(true);
  });

  it('ülke listesi: eşleşmeyen ülke düşer; ülke süzmesi kapalı (Tümü) ise geçer', () => {
    expect(matchesTargeting({ ...none, countries: ['ID'] }, ctx())).toBe(false);
    expect(matchesTargeting({ ...none, countries: ['ID', 'TH'] }, ctx())).toBe(true);
    expect(matchesTargeting({ ...none, countries: ['ID'] }, ctx({ country: null }))).toBe(true);
  });

  it('platform listesi: platformu bilinmeyen görüntüleyen düşer', () => {
    expect(matchesTargeting({ ...none, platforms: ['ios'] }, ctx())).toBe(false);
    expect(matchesTargeting({ ...none, platforms: ['android'] }, ctx())).toBe(true);
    expect(matchesTargeting({ ...none, platforms: ['android'] }, ctx({ platform: null }))).toBe(false);
  });

  it('dil listesi', () => {
    expect(matchesTargeting({ ...none, locales: ['id'] }, ctx())).toBe(false);
    expect(matchesTargeting({ ...none, locales: ['th', 'en'] }, ctx())).toBe(true);
  });
});

describe('pickLocalized', () => {
  const filled = (s: string) => s.trim().length > 0;

  it('kullanıcının dili → en → SUPPORTED_LOCALES sırasıyla ilk dolu', () => {
    expect(pickLocalized({ th: 'ก', en: 'E' }, 'th', filled)).toBe('ก');
    expect(pickLocalized({ en: 'E', tr: 'T' }, 'th', filled)).toBe('E');
    // SUPPORTED_LOCALES sırası: ... 'th', 'id' → th önce gelir (JSON anahtar sırasına güvenilmez).
    expect(pickLocalized({ id: 'I', th: 'ก' }, 'de', filled)).toBe('ก');
  });

  it('yalnız boşluk dolu sayılmaz; hiçbiri yoksa null', () => {
    expect(pickLocalized({ th: '  ', en: 'E' }, 'th', filled)).toBe('E');
    expect(pickLocalized({ th: ' ' }, 'th', filled)).toBeNull();
    expect(pickLocalized(null, 'th', filled)).toBeNull();
  });
});

describe('resolveSections', () => {
  it('yayındaki carousel: dil seçilir, ürün hedefi katalogdan çözülür', () => {
    const views = resolveSections([section()], [banner()], catalog, ctx({ locale: 'de' }));

    expect(views).toEqual([{
      id: 's1', type: 'banner_carousel', heading: 'Deals', is_draft: false, autoplay_seconds: 5,
      items: [{
        id: 'b1', image_url: 'https://cdn.example/b1.jpg', title: 'Grab 50', subtitle: 'Ride', cta_label: 'Get',
        action: { type: 'catalog_item', catalog_item: { id: 'c-grab-th', country_code: 'TH' } },
      }],
    }]);
  });

  it('taslak normal kullanıcıya görünmez; test admin is_draft ile görür', () => {
    const draft = section({ status: 'draft' });
    expect(resolveSections([draft], [banner()], catalog, ctx())).toEqual([]);
    const [view] = resolveSections([draft], [banner()], catalog, ctx({ isTestAdmin: true }));
    expect(view.is_draft).toBe(true);
  });

  it('kart görünmesi için bölümün VE kartın hedeflemesine uymalı; kart NULL = bölümden devralır', () => {
    const s = section({ countries: ['TH'] });
    const cards = [
      banner({ id: 'b-all' }),
      banner({ id: 'b-ios', sort_order: 1, platforms: ['ios'] }),
      banner({ id: 'b-id', sort_order: 2, countries: ['ID'] }),
    ];
    const [view] = resolveSections([s], cards, catalog, ctx());
    expect(view.items.map((i) => i.id)).toEqual(['b-all']);
    expect(resolveSections([s], cards, catalog, ctx({ country: 'ID' }))).toEqual([]);
  });

  it('pasif kart, görselsiz ya da başlıksız banner düşer; kartı kalmayan bölüm yanıtta yok', () => {
    const cards = [
      banner({ id: 'b-off', is_active: false }),
      banner({ id: 'b-noimg', image_url: null }),
      banner({ id: 'b-notitle', content: { en: { title: '  ', subtitle: 'x' } } }),
    ];
    expect(resolveSections([section()], cards, catalog, ctx())).toEqual([]);
  });

  it('ürün hedefi görünür katalogda değilse (pasif/silinmiş/başka ülke) kart düşer', () => {
    const cards = [banner({ id: 'b-gone', action_catalog_item_id: 'c-yok' }), banner({ id: 'b-ok', sort_order: 1 })];
    const [view] = resolveSections([section()], cards, catalog, ctx());
    expect(view.items.map((i) => i.id)).toEqual(['b-ok']);
  });

  it('uygulama içi sayfa: geçerli rota geçer, bilinmeyen rota düşer; butonsuz (none) geçer', () => {
    const cards = [
      banner({ id: 'b-route', action_type: 'app_route', action_catalog_item_id: null, action_route: 'diamonds' }),
      banner({ id: 'b-bad', sort_order: 1, action_type: 'app_route', action_catalog_item_id: null, action_route: 'settings' }),
      banner({ id: 'b-none', sort_order: 2, action_type: 'none', action_catalog_item_id: null, content: { en: { title: 'Hi' } } }),
    ];
    const [view] = resolveSections([section()], cards, catalog, ctx());
    const viewBanner = view as { type: 'banner_carousel'; items: any[] };
    expect(viewBanner.items.map((i) => [i.id, i.action])).toEqual([
      ['b-route', { type: 'app_route', route: 'diamonds' }],
      ['b-none', { type: 'none' }],
    ]);
    expect(viewBanner.items[1]).toMatchObject({ subtitle: null, cta_label: null });
  });

  it('öne çıkanlar: ürün çözülür, çözülmeyen düşer; başlık yoksa null', () => {
    const s = section({ id: 's2', section_type: 'featured_items', heading: null });
    const [view] = resolveSections(
      [s],
      [featured(), featured({ id: 'f-id', sort_order: 1, catalog_item_id: 'c-yok' })],
      catalog,
      ctx(),
    );
    expect(view).toEqual({
      id: 's2', type: 'featured_items', heading: null, is_draft: false,
      items: [{ id: 'f1', catalog_item: { id: 'c-grab-th', country_code: 'TH' } }],
    });
  });

  it('sıra: sort_order, eşitlikte id; bilinmeyen bölüm türü atlanır', () => {
    const sections = [
      section({ id: 'sB', sort_order: 1 }),
      section({ id: 'sA', sort_order: 1 }),
      section({ id: 'sX', sort_order: 0, section_type: 'brand_strip' as never }),
    ];
    const cards = sections.map((s) => banner({ id: `b-${s.id}`, section_id: s.id }));
    expect(resolveSections(sections, cards, catalog, ctx()).map((v) => v.id)).toEqual(['sA', 'sB']);
  });

  it('sınırlar: carousel 8 kart, öne çıkanlar 12 ürün, sayfa 10 bölüm', () => {
    const cards = Array.from({ length: 10 }, (_, n) => banner({ id: `b${n}`, sort_order: n }));
    expect(resolveSections([section()], cards, catalog, ctx())[0].items).toHaveLength(SECTION_LIMITS.carouselItems);

    const s2 = section({ id: 's2', section_type: 'featured_items' });
    const feats = Array.from({ length: 14 }, (_, n) => featured({ id: `f${n}`, sort_order: n }));
    expect(resolveSections([s2], feats, catalog, ctx())[0].items).toHaveLength(SECTION_LIMITS.featuredItems);

    const many = Array.from({ length: 12 }, (_, n) => section({ id: `s${String(n).padStart(2, '0')}`, sort_order: n }));
    const perSection = many.map((s) => banner({ id: `b-${s.id}`, section_id: s.id }));
    expect(resolveSections(many, perSection, catalog, ctx())).toHaveLength(SECTION_LIMITS.sectionsPerPage);
  });

  it('sınır geçersiz kartlar düştükten SONRA sayılır: öndeki geçersiz kartlar yer kaplamaz', () => {
    // Görselsiz, pasif ve hedefi çözülmeyen kartlar (her türden 3) geçerlilerin ÖNÜNDE.
    const invalid = [0, 1, 2].flatMap((n) => [
      banner({ id: `x-noimg-${n}`, sort_order: n * 3, image_url: null }),
      banner({ id: `x-off-${n}`, sort_order: n * 3 + 1, is_active: false }),
      banner({ id: `x-gone-${n}`, sort_order: n * 3 + 2, action_catalog_item_id: 'c-yok' }),
    ]);
    const valid = Array.from({ length: 9 }, (_, n) => banner({ id: `b${n}`, sort_order: 100 + n }));
    const [carousel] = resolveSections([section()], [...invalid, ...valid], catalog, ctx());
    expect(carousel.items.map((i) => i.id)).toEqual(valid.slice(0, SECTION_LIMITS.carouselItems).map((c) => c.id));

    const s2 = section({ id: 's2', section_type: 'featured_items' });
    const unresolved = Array.from({ length: 12 }, (_, n) => featured({ id: `x${n}`, sort_order: n, catalog_item_id: 'c-yok' }));
    const feats = Array.from({ length: 13 }, (_, n) => featured({ id: `f${n}`, sort_order: 100 + n }));
    const [featuredView] = resolveSections([s2], [...unresolved, ...feats], catalog, ctx());
    expect(featuredView.items.map((i) => i.id)).toEqual(feats.slice(0, SECTION_LIMITS.featuredItems).map((c) => c.id));
  });
});
