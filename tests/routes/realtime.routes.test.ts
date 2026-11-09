import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import jwt from 'jsonwebtoken';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

/**
 * POST /api/v1/realtime/token kablolaması gerçek Express, gerçek authMiddleware ve errorHandler ile
 * loopback'te sınanır. İmzalayıcı env'den kurulur (env.ts her testte yeniden parse edilir). DB fake.
 */
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const LEGACY = 'legacy-supabase-secret-for-test';
const ENV_KEYS = ['SUPABASE_JWT_SECRET', 'SUPABASE_JWT_PRIVATE_JWK'] as const;

let close: (() => Promise<void>) | null = null;

async function serve(signer: { legacySecret?: string }) {
  // Yerel .env'de değer olsa bile testi o belirlemesin: iki anahtar da açıkça yazılır (dotenv ezmez).
  process.env.SUPABASE_JWT_SECRET = signer.legacySecret ?? '';
  process.env.SUPABASE_JWT_PRIVATE_JWK = '';

  const fake = createFakeSupabase({
    users: [
      { id: U1, email: 'a@b.co', is_banned: false },
      { id: U2, email: 'c@d.co', is_banned: false },
      { id: 'banned-user', email: 'x@y.co', is_banned: true },
    ],
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));

  const express = (await import('express')).default;
  const { default: realtimeRoutes } = await import('../../src/routes/realtime.routes.js');
  const { errorHandler } = await import('../../src/middleware/errorHandler.js');
  const { signAccessToken } = await import('../../src/utils/jwt.js');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/realtime', realtimeRoutes);
  app.use(errorHandler);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/api/v1/realtime/token`;
  const post = (userId?: string) =>
    fetch(url, {
      method: 'POST',
      headers: userId ? { authorization: `Bearer ${signAccessToken({ userId, email: 'a@b.co' })}` } : {},
    });
  return { fake, post };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(async () => {
  await close?.();
  close = null;
  for (const k of ENV_KEYS) delete process.env[k];
});

describe('POST /api/v1/realtime/token', () => {
  it('kimliksiz istek 401 INVALID_TOKEN, token üretilmez', async () => {
    const { post } = await serve({ legacySecret: LEGACY });
    const res = await post();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('INVALID_TOKEN');
  });

  it(`girişli kullanıcıya { token, expiresAt }; sub = kendi id'si, role = authenticated`, async () => {
    const { post } = await serve({ legacySecret: LEGACY });
    const before = Date.now();
    const res = await post(U1);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'token']);

    const claims = jwt.verify(body.token, LEGACY, { algorithms: ['HS256'], audience: 'authenticated' }) as jwt.JwtPayload;
    expect(claims.sub).toBe(U1);
    expect(claims.role).toBe('authenticated');
    expect(claims.iss).toBe('https://test.supabase.co/auth/v1');
    const exp = new Date(body.expiresAt).getTime();
    expect(exp).toBe(claims.exp! * 1000);
    expect(exp - before).toBeGreaterThan(590_000);
    expect(exp - before).toBeLessThanOrEqual(601_000);
  });

  it('banlı kullanıcı token alamaz (authMiddleware 403)', async () => {
    const { post } = await serve({ legacySecret: LEGACY });
    const res = await post('banned-user');
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ACCOUNT_BANNED');
  });

  it('imzalayıcı yapılandırılmamışsa 503 REALTIME_TOKEN_UNAVAILABLE (mobil anon bağlantıda kalır)', async () => {
    const { post } = await serve({});
    const res = await post(U1);
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('REALTIME_TOKEN_UNAVAILABLE');
  });

  it('kullanıcı başına dakikada 10: 11. istek 429, başka kullanıcı etkilenmez', async () => {
    const { post } = await serve({ legacySecret: LEGACY });
    for (let i = 0; i < 10; i++) expect((await post(U1)).status).toBe(200);
    const limited = await post(U1);
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe('RATE_LIMITED');
    expect((await post(U2)).status).toBe(200);
  });

  it('imzalama Supabase isteği yapmaz; yalnız ban kontrolü (60 sn önbellekli) okunur', async () => {
    const { post, fake } = await serve({ legacySecret: LEGACY });
    await post(U1);
    await post(U1);
    const reads = fake.queries.filter((q) => q.table === 'users');
    expect(reads).toHaveLength(1);
    expect(fake.queries.every((q) => q.table === 'users')).toBe(true);
  });
});
