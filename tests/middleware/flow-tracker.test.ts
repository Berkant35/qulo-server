import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

/**
 * flowTracker gercek Express + alt router ile loopback'te sinanir: alt router req.url'den
 * onekini soydugu icin yol "finish" aninda okunursa "/swipe" yazilir (prod flow_events,
 * 2026-10-03 teshisi). Dis ag yok, DB fake.
 */
let close: (() => Promise<void>) | null = null;

async function serve() {
  const fake = createFakeSupabase({ flow_events: [] });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const express = (await import('express')).default;
  const { flowTracker, flushFlowEvents } = await import('../../src/middleware/flowTracker.js');

  const matches = express.Router();
  matches.post('/swipe', (_req, res) => { res.json({ ok: true }); });
  matches.get('/discover', (_req, res) => { res.json({ cards: [] }); });
  const presence = express.Router();
  presence.post('/', (_req, res) => { res.status(204).end(); });
  const users = express.Router();
  users.delete('/me/photos/:id', (_req, res) => { res.json({ ok: true }); });

  const app = express();
  app.use(flowTracker);
  app.use('/api/v1/matches', matches);
  app.use('/api/v1/users/me/presence', presence);
  app.use('/api/v1/users', users);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  /** Istegi atar, "finish" dinleyicisinin calismasini bekler, tamponu bosaltir. */
  const kaydet = async (method: string, path: string) => {
    await fetch(base + path, { method });
    await new Promise((r) => setImmediate(r));
    await flushFlowEvents();
    return fake.table("flow_events") as Array<Record<string, unknown>>;
  };
  return { kaydet };
}

beforeEach(() => vi.resetModules());
afterEach(async () => {
  await close?.();
  close = null;
});

describe('flowTracker — alt router altinda tam yol', () => {
  it('POST /api/v1/matches/swipe tam yolla, eslenen akis adi ve kategoriyle yazilir', async () => {
    const { kaydet } = await serve();
    const [satir] = await kaydet('POST', '/api/v1/matches/swipe');
    expect(satir).toMatchObject({
      endpoint: '/api/v1/matches/swipe',
      method: 'POST',
      event_name: 'swipe',
      event_category: 'matching',
      status_code: 200,
    });
  });

  it('sorgu dizesi yola girmez, metadata.query olarak kalir', async () => {
    const { kaydet } = await serve();
    const [satir] = await kaydet('GET', '/api/v1/matches/discover?page=2');
    expect(satir).toMatchObject({ endpoint: '/api/v1/matches/discover', event_name: 'discover_load' });
    expect((satir.metadata as Record<string, unknown>).query).toEqual({ page: '2' });
  });

  it('presence ("POST /") artik ayirt edilir: presence_heartbeat', async () => {
    const { kaydet } = await serve();
    const [satir] = await kaydet('POST', '/api/v1/users/me/presence');
    expect(satir).toMatchObject({ endpoint: '/api/v1/users/me/presence', event_name: 'presence_heartbeat', event_category: 'profile' });
  });

  it('dinamik parca normalize edilir: /photos/3 -> /photos/:id', async () => {
    const { kaydet } = await serve();
    const [satir] = await kaydet('DELETE', '/api/v1/users/me/photos/3');
    expect(satir).toMatchObject({ endpoint: '/api/v1/users/me/photos/:id', event_name: 'delete_photo' });
  });
});
