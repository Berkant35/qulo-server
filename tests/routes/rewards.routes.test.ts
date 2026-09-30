import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';
import { activeConfigRow, rainbowSwitchRow } from '../helpers/economy-config.fixture.js';

/**
 * Router'ı gerçek Express + errorHandler ile loopback'te (127.0.0.1) ayağa kaldırır: kablolama
 * (auth → 401, doğrulama → 400, handler → 200) gerçekten sınanır. Dış ağ yok, DB fake.
 */
let close: (() => Promise<void>) | null = null;

async function serve(seed: Tables, opts: { fakeAuth: boolean }) {
  const fake = createFakeSupabase({
    economy_config_versions: [activeConfigRow()],
    reward_market_countries: [
      { country_code: 'TH', currency: 'THB', enabled: true, android_enabled: true, ios_enabled: false },
    ],
    reward_catalog_items: [
      { id: '3f1c9a52-7d7e-4b8e-9d6a-1b2c3d4e5f60', brand_key: 'GRAB', country_code: 'TH', currency: 'THB', face_value: 50, cost_usd: 1.51, rainbow_price: 51, is_active: true, sort_order: 1, logo_url: null, deleted_at: null },
    ],
    reward_redemptions: [],
    diamond_transactions: [],
    users: [{
      id: 'u1', country: 'TH', created_at: '2026-08-01T00:00:00Z', green_diamonds: 0, purple_diamonds: 0,
      purple_paid: 0, rainbow_diamonds: 200, is_test_admin: false, is_seed_profile: false, is_test_account: false,
      is_banned: false,
    }],
    ...seed,
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  if (opts.fakeAuth) {
    vi.doMock('../../src/middleware/auth.js', () => ({
      // `x-test-user` başlığı kimliği seçer (yoksa u1): kullanıcı anahtarlı limiter sınanabilsin.
      authMiddleware: (req: { user?: unknown; headers: Record<string, unknown> }, _res: unknown, next: () => void) => {
        req.user = { userId: typeof req.headers['x-test-user'] === 'string' ? req.headers['x-test-user'] : 'u1' };
        next();
      },
    }));
  }

  const express = (await import('express')).default;
  const { default: rewardsRoutes } = await import('../../src/routes/rewards.routes.js');
  const { errorHandler } = await import('../../src/middleware/errorHandler.js');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/rewards', rewardsRoutes);
  app.use(errorHandler);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  const { port } = server.address() as AddressInfo;
  return { fake, base: `http://127.0.0.1:${port}/api/v1/rewards` };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(async () => {
  await close?.();
  close = null;
  vi.doUnmock('../../src/middleware/auth.js');
});

describe('/api/v1/rewards — kablolama', () => {
  it('kimliksiz istek 401 (gerçek authMiddleware), doğrulamaya bile ulaşmaz', async () => {
    const { base, fake } = await serve({}, { fakeAuth: false });

    const market = await fetch(`${base}/market`);
    expect(market.status).toBe(401);
    expect((await market.json()).error.code).toBe('INVALID_TOKEN');

    const redeem = await fetch(`${base}/redeem`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item_id: 'x' }),
    });
    expect(redeem.status).toBe(401);
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it('bozuk itfa gövdesi 400 VALIDATION_ERROR, hiçbir şey yazılmaz', async () => {
    const { base, fake } = await serve({}, { fakeAuth: true });
    const res = await fetch(`${base}/redeem`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item_id: 'x' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it('GET /market platform başlığıyla 200', async () => {
    const { base } = await serve({}, { fakeAuth: true });
    const res = await fetch(`${base}/market`, { headers: { 'x-app-platform': 'android' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.monthly_cap).toBe(150);
  });

  it('GET /market platform başlığı yoksa 403 RAINBOW_NOT_AVAILABLE', async () => {
    const { base } = await serve({}, { fakeAuth: true });
    const res = await fetch(`${base}/market`);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('RAINBOW_NOT_AVAILABLE');
  });

  it('ana anahtar kapalı + test admin (test hesabı değil): /market ve /redeem 403 RAINBOW_NOT_AVAILABLE, /redemptions açık kalır', async () => {
    const { base, fake } = await serve({
      economy_config_versions: [rainbowSwitchRow(false)],
      users: [{
        id: 'u1', country: 'TH', created_at: '2026-08-01T00:00:00Z', green_diamonds: 0, purple_diamonds: 0,
        purple_paid: 0, rainbow_diamonds: 200, is_test_admin: true, is_seed_profile: false, is_test_account: false,
        is_banned: false,
      }],
    }, { fakeAuth: true });

    const market = await fetch(`${base}/market?country=TH`, { headers: { 'x-app-platform': 'android' } });
    expect(market.status).toBe(403);
    expect((await market.json()).error.code).toBe('RAINBOW_NOT_AVAILABLE');

    const redeem = await fetch(`${base}/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-app-platform': 'android' },
      body: JSON.stringify({
        item_id: '3f1c9a52-7d7e-4b8e-9d6a-1b2c3d4e5f60',
        idempotency_key: '11111111-1111-4111-8111-111111111111',
      }),
    });
    expect(redeem.status).toBe(403);
    expect((await redeem.json()).error.code).toBe('RAINBOW_NOT_AVAILABLE');
    expect(fake.table('reward_redemptions')).toHaveLength(0);
    expect(fake.table('users')[0].rainbow_diamonds).toBe(200);

    // Teslim edilmiş kodlar kullanıcının malı (spec §7.6): "Hediye kartlarım" Rainbow kapalıyken de okunur.
    expect((await fetch(`${base}/redemptions`)).status).toBe(200);
  });

  it('POST /redeem geçerli gövdeyle 200 ve PENDING talep', async () => {
    const { base, fake } = await serve({}, { fakeAuth: true });
    const res = await fetch(`${base}/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-app-platform': 'android' },
      body: JSON.stringify({
        item_id: '3f1c9a52-7d7e-4b8e-9d6a-1b2c3d4e5f60',
        idempotency_key: '11111111-1111-4111-8111-111111111111',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redemption.status).toBe('PENDING');
    expect(body.balance).toBe(149);
    expect(fake.table('reward_redemptions')).toHaveLength(1);
  });

  it('GET /redemptions limit 50 üstü 400; geçerli sorgu 200', async () => {
    const { base } = await serve({}, { fakeAuth: true });
    expect((await fetch(`${base}/redemptions?limit=99`)).status).toBe(400);
    const ok = await fetch(`${base}/redemptions?page=1&limit=10`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ items: [], total: 0, page: 1, limit: 10 });
  });

  it('okuma limiti kullanıcı anahtarlı, dakikada 60: aynı kullanıcının 61. okuması 429; aynı IP’deki başka kullanıcı etkilenmez', async () => {
    const { base } = await serve({}, { fakeAuth: true });
    for (let i = 0; i < 60; i++) {
      const ok = await fetch(`${base}/redemptions`, { headers: { 'x-test-user': 'u1' } });
      expect(ok.status).toBe(200);
    }
    // /market ve /redemptions aynı kullanıcı bütçesini paylaşır.
    const limited = await fetch(`${base}/market`, { headers: { 'x-test-user': 'u1', 'x-app-platform': 'android' } });
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe('RATE_LIMITED');

    const other = await fetch(`${base}/redemptions`, { headers: { 'x-test-user': 'u2' } });
    expect(other.status).toBe(200);
  });

  it('GET /market: normal kullanıcıda ?country yok sayılır, bozuk değer 400 değil; Accept-Language bölüm dilini seçer', async () => {
    const { base } = await serve({
      page_sections: [{
        id: 's1', page_key: 'rewards_market', section_type: 'banner_carousel', heading: { en: 'Deals', th: 'ดีล' },
        sort_order: 0, status: 'published', countries: null, platforms: null, locales: null, autoplay_seconds: 5, deleted_at: null,
      }],
      page_section_items: [{
        id: 'b1', section_id: 's1', sort_order: 0, is_active: true, countries: null, platforms: null, locales: null,
        image_url: 'https://cdn.example/b1.jpg', content: { en: { title: 'Hi' } }, action_type: 'none',
        action_catalog_item_id: null, action_route: null, catalog_item_id: null,
      }],
    }, { fakeAuth: true });

    const res = await fetch(`${base}/market?country=id`, { headers: { 'x-app-platform': 'android', 'accept-language': 'th-TH,th;q=0.9' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((i: { country_code: string }) => i.country_code)).toEqual(['TH']);
    expect(body.sections[0].heading).toBe('ดีล');

    const bad = await fetch(`${base}/market?country=ZZZ`, { headers: { 'x-app-platform': 'android' } });
    expect(bad.status).toBe(200);
    expect((await bad.json()).sections[0].heading).toBe('Deals');
  });

  it('POST /redeem: source_item_id iletilir; bozuk değer 400 değil, yok sayılır', async () => {
    const { base, fake } = await serve({
      page_sections: [{
        id: 's1', page_key: 'rewards_market', section_type: 'featured_items', heading: null, sort_order: 0,
        status: 'published', countries: null, platforms: null, locales: null, autoplay_seconds: 5, deleted_at: null,
      }],
      page_section_items: [{
        id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', section_id: 's1', sort_order: 0, is_active: true,
        countries: null, platforms: null, locales: null, image_url: null, content: null, action_type: 'none',
        action_catalog_item_id: null, action_route: null, catalog_item_id: '3f1c9a52-7d7e-4b8e-9d6a-1b2c3d4e5f60',
      }],
    }, { fakeAuth: true });
    const post = (key: string, source: unknown) => fetch(`${base}/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-app-platform': 'android' },
      body: JSON.stringify({ item_id: '3f1c9a52-7d7e-4b8e-9d6a-1b2c3d4e5f60', idempotency_key: key, source_item_id: source }),
    });

    expect((await post('11111111-1111-4111-8111-111111111111', '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d')).status).toBe(200);
    expect((await post('22222222-2222-4222-8222-222222222222', 'bozuk')).status).toBe(200);
    expect(fake.table('reward_redemptions').map((r) => r.source_item_id)).toEqual(['9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', null]);
  });

  it('POST /events: kimliksiz 401; boş, 51 olay ya da bozuk uuid 400; geçerli 204; dakikada 30 istek sonra 429', async () => {
    const unauth = await serve({}, { fakeAuth: false });
    expect((await fetch(`${unauth.base}/events`, { method: 'POST' })).status).toBe(401);
    await close?.();
    close = null;
    vi.resetModules();

    const { base } = await serve({}, { fakeAuth: true });
    const post = (events: unknown, user = 'u1') => fetch(`${base}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-app-platform': 'android', 'x-test-user': user },
      body: JSON.stringify({ events }),
    });
    const one = { item_id: '0b1b1b1b-0000-4000-8000-000000000001', event: 'impression' };

    expect((await post([])).status).toBe(400);
    expect((await post(Array.from({ length: 51 }, () => one))).status).toBe(400);
    expect((await post([{ item_id: 'x', event: 'impression' }])).status).toBe(400);
    expect((await post([{ ...one, event: 'hover' }])).status).toBe(400);

    // Bilinmeyen kart da 204: istemci yeniden denemesin (sessizce düşer). Önceki 4 istek de limite sayıldı.
    for (let i = 0; i < 26; i++) expect((await post([one])).status).toBe(204);
    expect((await post([one])).status).toBe(429);
    expect((await post([one], 'u2')).status).toBe(204);
  });
});
