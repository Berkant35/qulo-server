import { describe, it, expect } from 'vitest';
import {
  bannerItemFormSchema,
  featuredItemFormSchema,
  sectionFormSchema,
  sectionStatsQuerySchema,
} from '../../src/validators/page-sections.validator.js';

const CAT = '5a000000-0000-4000-8000-000000000001';

describe('sectionFormSchema', () => {
  it('dil alanları başlık haritasına toplanır; boşlar atlanır; hiç yoksa NULL', () => {
    const v = sectionFormSchema.parse({ section_type: 'banner_carousel', heading_tr: ' Fırsatlar ', heading_en: 'Deals', heading_th: '' });
    expect(v.heading).toEqual({ tr: 'Fırsatlar', en: 'Deals' });
    expect(sectionFormSchema.parse({ section_type: 'featured_items' }).heading).toBeNull();
  });

  it('çoklu seçim: yok → NULL, tek değer → dizi, tekrar ayıklanır; geçersiz ülke/platform/dil reddedilir', () => {
    const one = sectionFormSchema.parse({ section_type: 'banner_carousel', countries: 'TH', platforms: ['android', 'android'] });
    expect(one).toMatchObject({ countries: ['TH'], platforms: ['android'], locales: null });
    expect(sectionFormSchema.safeParse({ section_type: 'banner_carousel', countries: 'th' }).success).toBe(false);
    expect(sectionFormSchema.safeParse({ section_type: 'banner_carousel', platforms: 'web' }).success).toBe(false);
    expect(sectionFormSchema.safeParse({ section_type: 'banner_carousel', locales: 'xx' }).success).toBe(false);
  });

  it('başlık ≤ 40; kayma 0 ya da 3–10, boşsa 5', () => {
    expect(sectionFormSchema.safeParse({ section_type: 'banner_carousel', heading_en: 'x'.repeat(41) }).success).toBe(false);
    expect(sectionFormSchema.parse({ section_type: 'banner_carousel', autoplay_seconds: '' }).autoplay_seconds).toBe(5);
    expect(sectionFormSchema.parse({ section_type: 'banner_carousel', autoplay_seconds: '0' }).autoplay_seconds).toBe(0);
    expect(sectionFormSchema.safeParse({ section_type: 'banner_carousel', autoplay_seconds: '2' }).success).toBe(false);
    expect(sectionFormSchema.safeParse({ section_type: 'banner_carousel', autoplay_seconds: '11' }).success).toBe(false);
    expect(sectionFormSchema.safeParse({ section_type: 'hero' }).success).toBe(false);
  });
});

describe('bannerItemFormSchema', () => {
  const base = { action_type: 'none', is_active: 'on' };

  it('dil başına başlık/alt başlık/buton; en az bir dilde başlık zorunlu', () => {
    const v = bannerItemFormSchema.parse({ ...base, title_en: 'Grab 50', subtitle_en: 'Ride', cta_en: 'Get', title_th: 'แกร็บ' });
    expect(v.content).toEqual({ en: { title: 'Grab 50', subtitle: 'Ride', cta_label: 'Get' }, th: { title: 'แกร็บ' } });
    expect(v.is_active).toBe(true);
    expect(bannerItemFormSchema.safeParse(base).success).toBe(false);
  });

  it('alt başlık var başlık yok → o dil reddedilir; sınırlar 60/120/24', () => {
    expect(bannerItemFormSchema.safeParse({ ...base, subtitle_en: 'x' }).success).toBe(false);
    expect(bannerItemFormSchema.safeParse({ ...base, title_en: 'x'.repeat(61) }).success).toBe(false);
    expect(bannerItemFormSchema.safeParse({ ...base, title_en: 'x', subtitle_en: 'y'.repeat(121) }).success).toBe(false);
    expect(bannerItemFormSchema.safeParse({ ...base, title_en: 'x', cta_en: 'z'.repeat(25) }).success).toBe(false);
  });

  it('buton hedefi tutarlılığı: ürün/sayfa zorunlu; türe ait olmayan hedef temizlenir', () => {
    expect(bannerItemFormSchema.safeParse({ title_en: 'x', action_type: 'catalog_item' }).success).toBe(false);
    expect(bannerItemFormSchema.safeParse({ title_en: 'x', action_type: 'app_route' }).success).toBe(false);
    expect(bannerItemFormSchema.safeParse({ title_en: 'x', action_type: 'app_route', action_route: 'settings' }).success).toBe(false);

    const product = bannerItemFormSchema.parse({ title_en: 'x', action_type: 'catalog_item', action_catalog_item_id: CAT, action_route: 'diamonds' });
    expect(product).toMatchObject({ action_catalog_item_id: CAT, action_route: null, is_active: false });
    const route = bannerItemFormSchema.parse({ title_en: 'x', action_type: 'app_route', action_route: 'diamonds', action_catalog_item_id: CAT });
    expect(route).toMatchObject({ action_route: 'diamonds', action_catalog_item_id: null });
  });
});

describe('featuredItemFormSchema + sectionStatsQuerySchema', () => {
  it('öne çıkan kart uuid ürün ister', () => {
    expect(featuredItemFormSchema.safeParse({ catalog_item_id: 'x' }).success).toBe(false);
    expect(featuredItemFormSchema.parse({ catalog_item_id: CAT, locales: 'th' })).toMatchObject({ catalog_item_id: CAT, locales: ['th'], is_active: false });
  });

  it('istatistik günü 7 ya da 30; bozuk → 7', () => {
    expect(sectionStatsQuerySchema.parse({ days: '30' }).days).toBe(30);
    expect(sectionStatsQuerySchema.parse({ days: '9' }).days).toBe(7);
    expect(sectionStatsQuerySchema.parse({}).days).toBe(7);
  });
});
