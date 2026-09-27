import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';

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
      authMiddleware: (req: { user?: unknown }, _res: unknown, next: () => void) => {
        req.user = { userId: 'u1' };
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
});
