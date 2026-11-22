import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

/** GET /api/v1/app/cities + PATCH /api/v1/users/me/location/city — gercek Express + errorHandler, DB fake. */
let close: (() => Promise<void>) | null = null;

async function serve() {
  const fake = createFakeSupabase({
    users: [{ id: 'u1', lat: null, lng: null, city: null, country: null, is_deleted: false }],
    questions: [], user_details: [], matches: [], blocks: [],
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  vi.doMock('../../src/middleware/auth.js', () => ({
    authMiddleware: (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = { userId: 'u1' }; next(); },
  }));
  const express = (await import('express')).default;
  const { default: appRoutes } = await import('../../src/routes/app.routes.js');
  const { default: userRoutes } = await import('../../src/routes/user.routes.js');
  const { errorHandler } = await import('../../src/middleware/errorHandler.js');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/app', appRoutes);
  app.use('/api/v1/users', userRoutes);
  app.use(errorHandler);
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  const { port } = server.address() as AddressInfo;
  return { fake, base: `http://127.0.0.1:${port}/api/v1` };
}

beforeEach(() => vi.resetModules());
afterEach(async () => {
  await close?.();
  close = null;
  vi.doUnmock('../../src/middleware/auth.js');
});

describe('GET /app/cities', () => {
  it('ulke listesi + filtreli sehirler, onbellek basligi', async () => {
    const { base } = await serve();
    const res = await fetch(`${base}/app/cities?country=TR&q=izm`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age=86400');
    const body = await res.json();
    expect(body.countries).toContain('TR');
    expect(body.cities[0]).toEqual({ id: 'TR-izmir', name: 'İzmir', country: 'TR' });
  });

  it('gecersiz ulke kodu / limit 400 VALIDATION_ERROR', async () => {
    const { base } = await serve();
    expect((await fetch(`${base}/app/cities?country=turkey`)).status).toBe(400);
    expect((await fetch(`${base}/app/cities?limit=500`)).status).toBe(400);
  });
});

describe('PATCH /users/me/location/city', () => {
  it('gecerli sehir 200 ve users satiri sehir merkeziyle guncellenir', async () => {
    const { base, fake } = await serve();
    const res = await fetch(`${base}/users/me/location/city`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ city_id: 'IT-milano' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ city_id: 'IT-milano', city: 'Milano', country: 'IT', location_source: 'city' });
    expect(fake.table('users')[0]).toMatchObject({ lat: 45.4642, lng: 9.19, location_source: 'city' });
  });

  it('bicim disi id 400, bilinmeyen id 404 CITY_NOT_FOUND; ikisinde de yazim yok', async () => {
    const { base, fake } = await serve();
    const bad = await fetch(`${base}/users/me/location/city`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ city_id: 'istanbul' }),
    });
    expect(bad.status).toBe(400);
    const unknown = await fetch(`${base}/users/me/location/city`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ city_id: 'TR-atlantis' }),
    });
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.code).toBe('CITY_NOT_FOUND');
    expect(fake.table('users')[0]).toMatchObject({ lat: null });
  });
});
