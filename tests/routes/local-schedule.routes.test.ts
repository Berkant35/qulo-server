import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

let close: (() => Promise<void>) | null = null;
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();
const D = 24 * 3600 * 1000;

async function serve(fakeAuth: boolean, failOn: Parameters<typeof createFakeSupabase>[1] = {}) {
  const fake = createFakeSupabase({ users: [{ id: 'u1', is_deleted: false, local_schedule: null }, { id: 'u2', is_deleted: false, local_schedule: null }] }, failOn);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  if (fakeAuth) {
    vi.doMock('../../src/middleware/auth.js', () => ({
      authMiddleware: (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = { userId: 'u1' }; next(); },
    }));
  }
  const express = (await import('express')).default;
  const { default: userRoutes } = await import('../../src/routes/user.routes.js');
  const { errorHandler } = await import('../../src/middleware/errorHandler.js');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/users', userRoutes);
  app.use(errorHandler);
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/users/me/local-schedule`;
  const patch = (body: unknown) => fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { fake, patch };
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => { await close?.(); close = null; vi.doUnmock('../../src/middleware/auth.js'); vi.restoreAllMocks(); });

describe('PATCH /users/me/local-schedule', () => {
  it('kimliksiz → 401, hicbir sey yazilmaz', async () => {
    const { fake, patch } = await serve(false);
    const res = await patch({ localScheduled: ['new_people'], until: inMs(D) });
    expect(res.status).toBe(401);
    expect(fake.table('users').every((u) => u.local_schedule === null)).toBe(true);
  });

  it('gecerli plan → 204; yalniz kendi satirina {rules, until} yazilir (tekrarlar teke iner)', async () => {
    const { fake, patch } = await serve(true);
    const until = inMs(3 * D);
    const res = await patch({ localScheduled: ['quiz_unfinished', 'return_3d', 'quiz_unfinished'], until });
    expect(res.status).toBe(204);
    expect(fake.table('users').find((u) => u.id === 'u1')!.local_schedule).toEqual({ rules: ['quiz_unfinished', 'return_3d'], until });
    expect(fake.table('users').find((u) => u.id === 'u2')!.local_schedule).toBeNull();
  });

  it('bilinmeyen kural → 400, yazilmaz', async () => {
    const { fake, patch } = await serve(true);
    const res = await patch({ localScheduled: ['unread_message'], until: inMs(D) });
    expect(res.status).toBe(400);
    expect(fake.table('users').find((u) => u.id === 'u1')!.local_schedule).toBeNull();
  });

  it('until > simdi+8 gun → 400', async () => {
    const { patch } = await serve(true);
    expect((await patch({ localScheduled: ['new_people'], until: inMs(9 * D) })).status).toBe(400);
  });

  it('bos liste mevcut plani temizler (NULL); until gerekmez', async () => {
    const { fake, patch } = await serve(true);
    await patch({ localScheduled: ['new_people'], until: inMs(D) });
    expect(fake.table('users').find((u) => u.id === 'u1')!.local_schedule).not.toBeNull();
    const res = await patch({ localScheduled: [] });
    expect(res.status).toBe(204);
    expect(fake.table('users').find((u) => u.id === 'u1')!.local_schedule).toBeNull();
  });

  it('DB hatasi → 500 (sessizce yutulmaz)', async () => {
    const { patch } = await serve(true, { failOn: [{ table: 'users', op: 'update' }] });
    expect((await patch({ localScheduled: ['new_people'], until: inMs(D) })).status).toBe(500);
  });
});
