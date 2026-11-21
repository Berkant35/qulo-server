import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { createFakeSupabase } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';

const NOW = Date.now();
const SECRET = 'route-secret-0123456789abcdef';
const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PEM = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
let close: (() => Promise<void>) | null = null;

async function serve(fakeAuth: boolean) {
  const row = activeConfigRow();
  row.config = { ...row.config, rewards: { ...row.config.rewards, rewardedAd: { enabled: true, purple: 10, dailyLimit: 1 } } };
  const fake = createFakeSupabase(
    {
      economy_config_versions: [row],
      users: [{ id: 'u1', purple_diamonds: 0, purple_paid: 0, green_diamonds: 0 }],
      diamond_transactions: [], rewarded_ad_claims: [],
    },
    { unique: { rewarded_ad_claims: ['transaction_id', 'user_id,day,slot'] } },
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  vi.doMock('../../src/services/admob-ssv-keys.js', () => ({ googleKeyProvider: async (id: string) => (id === '1' ? PEM : null) }));
  if (fakeAuth) {
    vi.doMock('../../src/middleware/auth.js', () => ({
      authMiddleware: (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = { userId: 'u1' }; next(); },
    }));
  }
  const express = (await import('express')).default;
  const { default: rewardsRoutes } = await import('../../src/routes/rewards.routes.js');
  const { default: adRoutes } = await import('../../src/routes/rewarded-ad.routes.js');
  const { errorHandler } = await import('../../src/middleware/errorHandler.js');
  const app = express();
  app.use(express.json());
  // index.ts ile aynı sıra: rewarded-ad, rewards'tan ÖNCE (rewards router'ı hepsine auth uygular).
  app.use('/api/v1/rewards/rewarded-ad', adRoutes);
  app.use('/api/v1/rewards', rewardsRoutes);
  app.use(errorHandler);
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return { fake, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/rewards/rewarded-ad` };
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  process.env.REWARDED_AD_TOKEN_SECRET = SECRET;
  process.env.REWARDED_AD_UNIT_IDS = '1234567890';
});
afterEach(async () => {
  await close?.();
  close = null;
  vi.doUnmock('../../src/middleware/auth.js');
  vi.restoreAllMocks();
  delete process.env.REWARDED_AD_TOKEN_SECRET;
  delete process.env.REWARDED_AD_UNIT_IDS;
});

describe('/api/v1/rewards/rewarded-ad', () => {
  it('status kimliksiz 401 (gerçek authMiddleware)', async () => {
    const { base } = await serve(false);
    const res = await fetch(`${base}/status`);
    expect(res.status).toBe(401);
  });

  it('status -> SSV: ham sorguyla imzalı callback kimliksiz ödül verir, tekrar vermez', async () => {
    const { base, fake } = await serve(true);
    const status = await (await fetch(`${base}/status`)).json();
    expect(status.available).toBe(true);
    const params: Record<string, string> = {
      ad_network: '1', ad_unit: '1234567890', custom_data: status.customData, reward_amount: '1',
      reward_item: 'coins', timestamp: String(NOW), transaction_id: 'tx-r1', user_id: status.ssvUserId,
    };
    const content = Object.keys(params).sort().map((k) => `${k}=${encodeURIComponent(params[k]!)}`).join('&');
    const sig = createSign('SHA256').update(content).sign(pair.privateKey).toString('base64url');
    const url = `${base}/ssv?${content}&signature=${sig}&key_id=1`;

    // SSV kimliksiz: authMiddleware'li rewards router'ı araya girmemeli. (fakeAuth açık ama başlık yok.)
    const first = await fetch(url);
    expect(first.status).toBe(200);
    expect(fake.table('users')[0]!.purple_diamonds).toBe(10);
    expect((await fetch(url)).status).toBe(200);
    expect(fake.table('users')[0]!.purple_diamonds).toBe(10);

    const afterStatus = await (await fetch(`${base}/status`)).json();
    expect(afterStatus.available).toBe(false);

    const bad = await fetch(url.replace('tx-r1', 'tx-r2'));
    expect(bad.status).toBe(400);
    expect(fake.table('users')[0]!.purple_diamonds).toBe(10);
  });
});
