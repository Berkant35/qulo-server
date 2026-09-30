import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabaseOptions, type Tables } from '../helpers/fake-supabase.js';
import { rainbowSwitchRow } from '../helpers/economy-config.fixture.js';

const NOW = new Date('2026-09-28T12:00:00Z');
const B1 = '0b1b1b1b-0000-4000-8000-000000000001';
const B2 = '0b1b1b1b-0000-4000-8000-000000000002';
const B_DRAFT = '0b1b1b1b-0000-4000-8000-000000000003';
const B_OFF = '0b1b1b1b-0000-4000-8000-000000000004';
const UNKNOWN = '0b1b1b1b-0000-4000-8000-0000000000ff';

const section = (over: Record<string, unknown>) => ({
  page_key: 'rewards_market', section_type: 'banner_carousel', heading: null, sort_order: 0, status: 'published',
  countries: null, platforms: null, locales: null, autoplay_seconds: 5, deleted_at: null, ...over,
});
const card = (over: Record<string, unknown>) => ({
  sort_order: 0, is_active: true, countries: null, platforms: null, locales: null, image_url: 'https://cdn.example/x.jpg',
  content: { en: { title: 'x' } }, action_type: 'none', action_catalog_item_id: null, action_route: null, catalog_item_id: null, ...over,
});

async function setup(seed: Tables = {}, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase({
    economy_config_versions: [rainbowSwitchRow(true)],
    reward_market_countries: [{ country_code: 'TH', currency: 'THB', enabled: true, android_enabled: true, ios_enabled: false }],
    users: [{ id: 'u1', country: 'th', is_test_admin: false, is_seed_profile: false, is_test_account: false }],
    page_sections: [section({ id: 's1' }), section({ id: 's-draft', status: 'draft' })],
    page_section_items: [
      card({ id: B1, section_id: 's1' }), card({ id: B2, section_id: 's1', sort_order: 1 }),
      card({ id: B_DRAFT, section_id: 's-draft' }), card({ id: B_OFF, section_id: 's1', is_active: false }),
    ],
    page_section_events: [],
    ...seed,
  }, options);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { pageSectionEventsService } = await import('../../src/services/page-section-events.service.js');
  return { fake, pageSectionEventsService };
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

describe('pageSectionEventsService.record', () => {
  it('yayındaki kartların olayları tek toplu yazımla: bölüm, gün (UTC), ülke (büyük harf), platform', async () => {
    const { fake, pageSectionEventsService } = await setup();
    const written = await pageSectionEventsService.record('u1', [
      { item_id: B1, event: 'impression' }, { item_id: B1, event: 'click' }, { item_id: B2, event: 'impression' },
    ], 'android');

    expect(written).toBe(3);
    expect(fake.table('page_section_events')).toEqual([
      expect.objectContaining({ item_id: B1, section_id: 's1', user_id: 'u1', event: 'impression', country: 'TH', platform: 'android', day: '2026-09-28' }),
      expect.objectContaining({ item_id: B1, event: 'click' }),
      expect.objectContaining({ item_id: B2, event: 'impression' }),
    ]);
    expect(fake.queries.filter((q) => q.table === 'page_section_events')).toEqual([{ table: 'page_section_events', op: 'upsert' }]);
  });

  it('istek içi tekrar tek sayılır; aynı gün yeniden gönderim yeni satır açmaz; ertesi gün açar', async () => {
    const { fake, pageSectionEventsService } = await setup();
    await pageSectionEventsService.record('u1', [{ item_id: B1, event: 'impression' }, { item_id: B1, event: 'impression' }], 'android');
    await pageSectionEventsService.record('u1', [{ item_id: B1, event: 'impression' }], 'android');
    expect(fake.table('page_section_events')).toHaveLength(1);

    vi.setSystemTime(new Date('2026-09-29T00:00:01Z'));
    await pageSectionEventsService.record('u1', [{ item_id: B1, event: 'impression' }], 'android');
    expect(fake.table('page_section_events').map((e) => e.day)).toEqual(['2026-09-28', '2026-09-29']);
  });

  it('taslak, pasif ya da bilinmeyen kart sessizce düşer; hiçbiri kalmazsa DB\'ye hiç gidilmez', async () => {
    const { fake, pageSectionEventsService } = await setup();
    const written = await pageSectionEventsService.record('u1', [
      { item_id: B_DRAFT, event: 'impression' }, { item_id: B_OFF, event: 'click' }, { item_id: UNKNOWN, event: 'click' },
    ], 'android');
    expect(written).toBe(0);
    expect(fake.queries.filter((q) => q.table === 'users' || q.table === 'page_section_events')).toEqual([]);
  });

  it('market erişimi olmayan kullanıcının olayı yazılmaz (iOS kapalı ülke)', async () => {
    const { fake, pageSectionEventsService } = await setup();
    expect(await pageSectionEventsService.record('u1', [{ item_id: B1, event: 'impression' }], 'ios')).toBe(0);
    expect(fake.table('page_section_events')).toHaveLength(0);
  });

  it('ana anahtar kapalı: test admin (test hesabı değil) olayı yazılmaz; test hesabınınki yazılır', async () => {
    const { fake, pageSectionEventsService } = await setup({
      economy_config_versions: [rainbowSwitchRow(false)],
      users: [
        { id: 'adm', country: 'TH', is_test_admin: true, is_seed_profile: false, is_test_account: false },
        { id: 'qa', country: 'TR', is_test_admin: true, is_seed_profile: false, is_test_account: true },
      ],
    });
    expect(await pageSectionEventsService.record('adm', [{ item_id: B1, event: 'impression' }], 'android')).toBe(0);
    expect(fake.table('page_section_events')).toHaveLength(0);
    expect(await pageSectionEventsService.record('qa', [{ item_id: B1, event: 'impression' }], 'ios')).toBe(1);
    expect(fake.table('page_section_events').map((e) => e.user_id)).toEqual(['qa']);
  });

  it('yazım hatası SERVER_ERROR (sessiz yutulmaz)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { pageSectionEventsService } = await setup({}, { failOn: [{ table: 'page_section_events', op: 'insert' }] });
    await expect(
      pageSectionEventsService.record('u1', [{ item_id: B1, event: 'click' }], 'android'),
    ).rejects.toMatchObject({ code: 'SERVER_ERROR' });
  });
});

describe('pageSectionEventsService.stats', () => {
  it('RPC satırlarını kart başına toplar; kırılım gösterime göre azalan; since = şimdi − gün', async () => {
    const { fake, pageSectionEventsService } = await setup({}, {
      rpc: {
        page_section_item_stats: {
          data: [
            { item_id: B1, country: 'TH', platform: 'android', impressions: 5, clicks: 2, redemptions: 1 },
            { item_id: B1, country: 'ID', platform: 'ios', impressions: 9, clicks: 0, redemptions: 0 },
            { item_id: B2, country: 'TH', platform: 'android', impressions: 1, clicks: 1, redemptions: 0 },
          ],
        },
      },
    });

    const stats = await pageSectionEventsService.stats('rewards_market', 7);

    expect(fake.rpcCalls).toEqual([{
      name: 'page_section_item_stats',
      args: { p_page_key: 'rewards_market', p_since: '2026-09-21T12:00:00.000Z' },
    }]);
    expect(stats.get(B1)).toEqual({
      impressions: 14, clicks: 2, redemptions: 1,
      breakdown: [
        { country: 'ID', platform: 'ios', impressions: 9, clicks: 0, redemptions: 0 },
        { country: 'TH', platform: 'android', impressions: 5, clicks: 2, redemptions: 1 },
      ],
    });
    expect(stats.get(B2)?.clicks).toBe(1);
  });

  it('RPC hatası SERVER_ERROR', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { pageSectionEventsService } = await setup({}, { rpc: { page_section_item_stats: { error: { message: 'boom' } } } });
    await expect(pageSectionEventsService.stats('rewards_market', 30)).rejects.toMatchObject({ code: 'SERVER_ERROR' });
  });
});
