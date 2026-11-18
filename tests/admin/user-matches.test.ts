import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

/**
 * Admin kullanici detayinda "Matches" bolumu: adminService.getUserMatches.
 * Gercek servis kodu calisir; Supabase yerine offline fake (tests/helpers/fake-supabase.ts).
 */
const U = '11111111-1111-4111-8111-111111111111'; // inceleneden kullanici
const O1 = '22222222-2222-4222-8222-222222222222';
const O2 = '33333333-3333-4333-8333-333333333333';
const O3 = '44444444-4444-4444-8444-444444444444';
const O4 = '55555555-5555-4555-8555-555555555555';

const users = [
  { id: U, name: 'Ali', surname: 'Veli', photos: [] },
  { id: O1, name: 'Ayse', surname: 'Yilmaz', photos: ['https://cdn.test/a1.jpg', 'https://cdn.test/a2.jpg'], is_seed_profile: false, is_test_account: false },
  { id: O2, name: 'Mehmet', surname: null, photos: [], is_seed_profile: true, is_test_account: false },
  { id: O3, name: 'Zeynep', surname: 'Kaya', photos: [], is_seed_profile: false, is_test_account: true },
  { id: O4, name: 'Baskasi', surname: 'Biri', photos: [] },
];

const match = (id: string, u1: string, u2: string, matched_at: string, is_active = true) =>
  ({ id, user1_id: u1, user2_id: u2, matched_at, is_active });

async function setup(matches: Record<string, unknown>[], rpcUnread: Record<string, number> = {}, extra: Record<string, unknown> = {}) {
  const fake = createFakeSupabase(
    { users, matches, messages: [] },
    {
      rpc: {
        match_list_summaries: (args: { p_match_ids: string[] }) => ({
          data: args.p_match_ids.map((id) => ({
            match_id: id, content: null, sender_id: null, is_image: false, audio_url: null,
            created_at: null, unread_count: rpcUnread[id] ?? 0,
          })),
          error: undefined,
        }),
      },
      ...extra,
    },
  );
  // Ayni testte ikinci kurulum: servis modulu onbellekten donmesin, yeni fake'e baglansin.
  vi.resetModules();
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { adminService } = await import('../../src/admin/admin.service.js');
  return { service: adminService, fake };
}

beforeEach(() => vi.resetModules());

describe('getUserMatches — veri izolasyonu ve karsi taraf', () => {
  it('kullanici user1 veya user2 kolonunda ise gelir; baskasinin eslesmesi gelmez', async () => {
    const { service } = await setup([
      match('m1', U, O1, '2026-01-01T10:00:00Z'),
      match('m2', O2, U, '2026-01-02T10:00:00Z'),
      match('m3', O3, O4, '2026-01-03T10:00:00Z'),
    ]);

    const { matches, total } = await service.getUserMatches(U, { page: 1, limit: 20 });

    expect(matches.map((m) => m.id).sort()).toEqual(['m1', 'm2']);
    expect(total).toBe(2);
  });

  it('karsi taraf dogru secilir (kullanici hangi kolondaysa)', async () => {
    const { service } = await setup([
      match('m1', U, O1, '2026-01-01T10:00:00Z'),
      match('m2', O2, U, '2026-01-02T10:00:00Z'),
    ]);

    const { matches } = await service.getUserMatches(U, { page: 1, limit: 20 });
    const byId = Object.fromEntries(matches.map((m) => [m.id, m]));

    expect(byId.m1.other_id).toBe(O1);
    expect(byId.m1.other_name).toBe('Ayse Yilmaz');
    expect(byId.m2.other_id).toBe(O2);
    expect(byId.m2.other_name).toBe('Mehmet');
  });
});

describe('getUserMatches — siralama, sayfalama, satir alanlari', () => {
  it('en yeni eslesme once gelir', async () => {
    const { service } = await setup([
      match('m1', U, O1, '2026-01-01T10:00:00Z'),
      match('m2', O2, U, '2026-03-01T10:00:00Z'),
      match('m3', U, O3, '2026-02-01T10:00:00Z'),
    ]);

    const { matches } = await service.getUserMatches(U, { page: 1, limit: 20 });

    expect(matches.map((m) => m.id)).toEqual(['m2', 'm3', 'm1']);
  });

  it('sayfalama: 25 eslesme, sayfa 1 = 20, sayfa 2 = 5, toplam 25', async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      match(`m${i}`, U, O1, new Date(Date.UTC(2026, 0, 1) + i * 3600_000).toISOString()),
    );
    const { service } = await setup(rows);

    const p1 = await service.getUserMatches(U, { page: 1, limit: 20 });
    const p2 = await service.getUserMatches(U, { page: 2, limit: 20 });

    expect(p1.matches).toHaveLength(20);
    expect(p2.matches).toHaveLength(5);
    expect(p1.total).toBe(25);
    expect(p2.total).toBe(25);
    // Sayfalar çakışmaz: en yeni (m24) ilk sayfada, en eski (m0) ikinci sayfada
    expect(p1.matches[0].id).toBe('m24');
    expect(p2.matches.at(-1)?.id).toBe('m0');
  });

  it('limit 50 ile sinirli: 60 eslesmede istek 500 bile olsa 50 satir', async () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      match(`m${i}`, U, O1, new Date(Date.UTC(2026, 0, 1) + i * 3600_000).toISOString()),
    );
    const { service } = await setup(rows);

    const { matches, total } = await service.getUserMatches(U, { page: 1, limit: 500 });

    expect(matches).toHaveLength(50);
    expect(total).toBe(60);
  });

  it('ilk foto kucuk resim olarak secilir; isim yoksa null; seed/test/aktif/okunmamis alanlari', async () => {
    const { service } = await setup(
      [
        match('m1', U, O1, '2026-01-03T00:00:00Z', true),
        match('m2', U, O2, '2026-01-02T00:00:00Z', false),
        match('m3', U, O3, '2026-01-01T00:00:00Z', true),
      ],
      { m1: 4, m3: 2 },
    );

    const { matches } = await service.getUserMatches(U, { page: 1, limit: 20 });
    const byId = Object.fromEntries(matches.map((m) => [m.id, m]));

    expect(byId.m1.other_photo).toBe('https://cdn.test/a1.jpg');
    expect(byId.m1.is_active).toBe(true);
    expect(byId.m1.unread_count).toBe(4);
    expect(byId.m1.other_is_seed).toBe(false);
    expect(byId.m1.other_is_test).toBe(false);

    expect(byId.m2.other_photo).toBeNull();
    expect(byId.m2.other_name).toBe('Mehmet');
    expect(byId.m2.is_active).toBe(false);
    expect(byId.m2.other_is_seed).toBe(true);
    expect(byId.m2.unread_count).toBe(0);

    expect(byId.m3.other_is_test).toBe(true);
    expect(byId.m3.unread_count).toBe(2);
  });
});

describe('getUserMatches — sorgu sayisi ve kenar durumlar', () => {
  it('eslesme sayisi artsa da sorgu sayisi sabit (N+1 yok)', async () => {
    const small = await setup([match('m1', U, O1, '2026-01-01T00:00:00Z'), match('m2', U, O2, '2026-01-02T00:00:00Z'), match('m3', U, O3, '2026-01-03T00:00:00Z')]);
    await small.service.getUserMatches(U, { page: 1, limit: 20 });

    const big = await setup(Array.from({ length: 15 }, (_, i) => match(`b${i}`, U, O1, new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString())));
    await big.service.getUserMatches(U, { page: 1, limit: 20 });

    expect(small.fake.queries.map((q) => `${q.table}:${q.op}`)).toEqual(['matches:select', 'users:select']);
    expect(big.fake.queries.map((q) => `${q.table}:${q.op}`)).toEqual(['matches:select', 'users:select']);
    expect(small.fake.rpcCalls).toHaveLength(1);
    expect(big.fake.rpcCalls).toHaveLength(1);
  });

  it('bos liste: bos dizi, toplam 0, karsi taraf/ozet sorgusu yok', async () => {
    const { service, fake } = await setup([match('x1', O3, O4, '2026-01-01T00:00:00Z')]);

    const result = await service.getUserMatches(U, { page: 1, limit: 20 });

    expect(result).toEqual({ matches: [], total: 0 });
    expect(fake.queries.map((q) => q.table)).toEqual(['matches']);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it('gecersiz userId reddedilir (sorgu atilmaz)', async () => {
    const { service, fake } = await setup([]);

    await expect(service.getUserMatches("' or 1=1 --", { page: 1, limit: 20 })).rejects.toThrow(/Invalid UUID/);
    expect(fake.queries).toHaveLength(0);
  });

  it('eslesme sorgusu hata verirse hata yuzeye cikar (sessizce bos liste donmez)', async () => {
    const { service } = await setup([match('m1', U, O1, '2026-01-01T00:00:00Z')], {}, {
      failOn: [{ table: 'matches', op: 'select', error: { message: 'boom' } }],
    });

    await expect(service.getUserMatches(U, { page: 1, limit: 20 })).rejects.toThrow(/boom/);
  });
});
