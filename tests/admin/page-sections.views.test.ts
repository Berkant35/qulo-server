import { describe, it, expect } from 'vitest';
import ejs from 'ejs';
import { join } from 'node:path';
import { LOCALE_NAMES, SUPPORTED_LOCALES } from '../../src/constants/locales.js';
import { APP_ROUTES, SECTION_LIMITS, TARGET_PLATFORMS } from '../../src/utils/page-sections.js';
import { productLabel } from '../../src/admin/page-sections.admin.view.js';

/** Görünümler EJS'te çalışma anında derlenir: sözdizimi/yerel değişken hatası ancak render'da çıkar. */
const VIEWS = join(process.cwd(), 'src', 'admin', 'views');
const shared = {
  active: 'sections', session: { adminId: 'adm1', adminRole: 'SUPER_ADMIN', adminEmail: 'a@qulo.test' }, csrfToken: 'tok',
  locales: SUPPORTED_LOCALES, localeNames: LOCALE_NAMES, platforms: TARGET_PLATFORMS, appRoutes: APP_ROUTES,
  routeLabels: { diamonds: 'Elmaslar', exchange: 'Takas', subscription: 'Abonelik', discover: 'Keşfet', rewards_redemptions: 'Hediye kartlarım' },
  limits: SECTION_LIMITS, error: null, notice: null,
  countries: [{ country_code: 'TH', currency: 'THB' }, { country_code: 'ID', currency: 'IDR' }],
};
const render = (view: string, locals: Record<string, unknown>) =>
  ejs.renderFile(join(VIEWS, `${view}.ejs`), { ...shared, ...locals });

const section = { id: 's1', section_type: 'banner_carousel', heading: { tr: 'Fırsatlar' }, status: 'draft', countries: ['TH'], platforms: null, locales: null, autoplay_seconds: 5 };
const stats = { impressions: 3, clicks: 1, redemptions: 0, breakdown: [{ country: 'TH', platform: 'android', impressions: 3, clicks: 1, redemptions: 0 }] };
const item = { id: 'b1', section_id: 's1', is_active: true, countries: null, platforms: null, locales: ['th'], image_url: 'https://cdn.example/b.jpg', content: { en: { title: 'Grab', cta_label: 'Get' } }, action_type: 'none', action_catalog_item_id: null, action_route: null, catalog_item_id: null, target_unavailable: true, label: 'Grab', targeting: 'tüm ülkeler · tüm platformlar · th', stats };
const product = { id: 'c1', brand_key: 'GRAB' as const, country_code: 'TH', currency: 'THB', face_value: 50, is_active: false };
/** Controller seçenekleri etiketli verir (`productLabel`); görünüm etiketi yeniden kurmaz. */
const option = { ...product, label: productLabel(product) };

describe('sayfa bölümleri görünümleri', () => {
  it('nav\'da Sayfa bölümleri sekmesi', async () => {
    const html = await render('rewards-sections-list', { sections: [] });
    expect(html).toContain('/admin/rewards/sections');
    expect(html).toContain('Sayfa bölümleri');
    expect(html).toContain('Henüz bölüm yok');
  });

  it('liste: durum rozeti, uyarı, yayın düğmesi, csrf', async () => {
    const html = await render('rewards-sections-list', {
      sections: [{ ...section, targeting: 'TH · tüm platformlar · tüm diller', item_count: 2, active_item_count: 1, unavailable_count: 1 }],
    });
    expect(html).toContain('TASLAK');
    expect(html).toContain('1 kart görünmüyor');
    expect(html).toContain('Yayınla');
    expect(html).toContain('name="_csrf" value="tok"');
  });

  it('bölüm formu: yeni (tür seçimi) ve düzenleme (gizli tür + kart tablosu + istatistik)', async () => {
    const fresh = await render('rewards-section-edit', { section: null, items: [], form: null, days: 7, statsError: null });
    expect(fresh).toContain('name="section_type"');
    expect(fresh).toContain('name="heading_th"');

    const edit = await render('rewards-section-edit', { section, items: [item], form: null, days: 30, statsError: null });
    expect(edit).toContain('type="hidden" name="section_type" value="banner_carousel"');
    expect(edit).toContain('value="Fırsatlar"');
    expect(edit).toContain('görünmüyor: ürün pasif');
    expect(edit).toContain('TH/android: 3 gösterim, 1 tıklama, 0 itfa');
  });

  it('geçersiz form yeniden çiziminde girilen değerler korunur', async () => {
    const html = await render('rewards-section-edit', { section: null, items: [], form: { section_type: 'featured_items', heading_en: 'Hi', countries: ['ID'] }, days: 7, statsError: null, error: 'Form geçersiz' });
    expect(html).toContain('value="Hi"');
    expect(html).toMatch(/value="ID" checked/);
    expect(html).toContain('Form geçersiz');
  });

  it('kart formu: banner (multipart, 18 dil, hedef seçimi) ve öne çıkan ürün', async () => {
    const banner = await render('rewards-section-item-edit', { section, item, form: null, options: [option] });
    expect(banner).toContain('enctype="multipart/form-data"');
    expect(banner).toContain('name="title_th"');
    expect(banner).toContain('value="Get"');
    expect(banner).toContain('(pasif)');
    expect(banner).toContain('Hediye kartlarım');

    const featured = await render('rewards-section-item-edit', {
      section: { ...section, section_type: 'featured_items' }, item: null, form: null, options: [option],
    });
    expect(featured).toContain('name="catalog_item_id"');
    expect(featured).not.toContain('name="title_en"');
  });
});
