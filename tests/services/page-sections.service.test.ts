import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabaseOptions, type Tables } from '../helpers/fake-supabase.js';

const NOW = new Date('2026-09-28T12:00:00Z');

const section = (over: Record<string, unknown> = {}) => ({
  id: 's1', page_key: 'rewards_market', section_type: 'banner_carousel', heading: { en: 'Deals' }, sort_order: 0,
  status: 'published', countries: null, platforms: null, locales: null, autoplay_seconds: 5, deleted_at: null, ...over,
});
const card = (over: Record<string, unknown> = {}) => ({
  id: 'b1', section_id: 's1', sort_order: 0, is_active: true, countries: null, platforms: null, locales: null,
  image_url: 'https://cdn.example/b1.jpg', content: { en: { title: 'Hello' } }, action_type: 'none',
  action_catalog_item_id: null, action_route: null, catalog_item_id: null, ...over,
});

async function setup(seed: Tables, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase({ page_sections: [], page_section_items: [], ...seed }, options);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { pageSectionsService, PAGE_SECTIONS_TTL_MS } = await import('../../src/services/page-sections.service.js');
  const reads = (table: string) => fake.queries.filter((q) => q.table === table && q.op === 'select').length;
  return { fake, pageSectionsService, PAGE_SECTIONS_TTL_MS, reads };
}

const ctx = { country: 'TH', platform: 'android' as const, locale: 'en' as const, isTestAdmin: false };

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('pageSectionsService', () => {
  it('anlık görüntü: yalnız bu sayfanın silinmemiş bölümleri ve onların kartları', async () => {
    const { pageSectionsService } = await setup({
      page_sections: [section(), section({ id: 's-del', deleted_at: '2026-09-27T00:00:00Z' })],
      page_section_items: [card(), card({ id: 'b-del', section_id: 's-del' })],
    });
    const snap = await pageSectionsService.snapshot('rewards_market');
    expect(snap.sections.map((s) => s.id)).toEqual(['s1']);
    expect(snap.items.map((i) => i.id)).toEqual(['b1']);
  });

  it('bölüm yoksa kart tablosu hiç okunmaz', async () => {
    const { pageSectionsService, reads } = await setup({});
    await pageSectionsService.snapshot('rewards_market');
    expect(reads('page_section_items')).toBe(0);
  });

  it('60 sn önbellek: tekrar çözümlemede DB yok; süre dolunca ve invalidate sonrası yeniden okur', async () => {
    const { pageSectionsService, PAGE_SECTIONS_TTL_MS, reads } = await setup({
      page_sections: [section()], page_section_items: [card()],
    });
    await pageSectionsService.resolveForUser('rewards_market', ctx, []);
    await pageSectionsService.resolveForUser('rewards_market', ctx, []);
    expect(reads('page_sections')).toBe(1);

    vi.setSystemTime(new Date(NOW.getTime() + PAGE_SECTIONS_TTL_MS + 1));
    await pageSectionsService.snapshot('rewards_market');
    expect(reads('page_sections')).toBe(2);

    pageSectionsService.invalidate();
    await pageSectionsService.snapshot('rewards_market');
    expect(reads('page_sections')).toBe(3);
  });

  it('okuma sürerken invalidate: eski görüntü önbelleğe yazılmaz', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { pageSectionsService, reads } = await setup(
      { page_sections: [section()], page_section_items: [card()] },
      { holdRead: { table: 'page_sections', until: gate } },
    );
    const inFlight = pageSectionsService.snapshot('rewards_market');
    pageSectionsService.invalidate();
    release();
    await inFlight;
    await pageSectionsService.snapshot('rewards_market');
    expect(reads('page_sections')).toBe(2);
  });

  it('okuma hatası SERVER_ERROR ve önbelleğe yazılmaz', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { pageSectionsService, reads } = await setup(
      { page_sections: [section()] },
      { failOn: [{ table: 'page_section_items', op: 'select' }] },
    );
    await expect(pageSectionsService.snapshot('rewards_market')).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    await expect(pageSectionsService.snapshot('rewards_market')).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(reads('page_sections')).toBe(2);
  });

  it('publishedItemSections: yalnız yayındaki bölümlerin aktif kartları', async () => {
    const { pageSectionsService } = await setup({
      page_sections: [section(), section({ id: 's-draft', status: 'draft' })],
      page_section_items: [card(), card({ id: 'b-off', is_active: false }), card({ id: 'b-draft', section_id: 's-draft' })],
    });
    expect([...(await pageSectionsService.publishedItemSections('rewards_market'))]).toEqual([['b1', 's1']]);
  });
});
