import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

/** Uç, router yığınındaki gerçek handler'lar (validate + handler) elle koşturularak sınanır. */
async function call(query: Record<string, unknown>, rows: Record<string, unknown>[] = []) {
  const fake = createFakeSupabase({ whats_new: rows as any });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { default: router } = await import('../../src/routes/app.routes.js');
  const layer = (router as any).stack.find((l: any) => l.route?.path === '/whats-new');
  const handlers: Array<(req: any, res: any, next: (e?: unknown) => void) => unknown> =
    layer.route.stack.map((l: any) => l.handle);
  const req: any = { query, headers: {} };
  let body: unknown;
  let error: any;
  const res: any = { json: (b: unknown) => { body = b; } };
  for (const h of handlers) {
    let nextErr: unknown; let called = false;
    await h(req, res, (e) => { called = true; nextErr = e; });
    if (called && nextErr) { error = nextErr; break; }
  }
  return { body, error, fake, method: layer.route.methods };
}

const row = {
  id: 'w1', app_version: '2.2.0', platform: 'all', is_active: true, image_url: null,
  content: { en: { title: 'EN', body: 'b', cta_label: '' }, tr: { title: 'TR', body: 'b', cta_label: 'Tamam' } },
};

beforeEach(() => vi.resetModules());

describe('GET /app/whats-new', () => {
  it('geçersiz semver 400 VALIDATION_ERROR', async () => {
    const { error, body } = await call({ version: 'abc', platform: 'ios' }, [row]);
    expect(error).toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(body).toBeUndefined();
  });

  it('geçersiz platform 400', async () => {
    const { error } = await call({ version: '2.2.0', platform: 'web' }, [row]);
    expect(error).toMatchObject({ statusCode: 400 });
  });

  it('bilinmeyen locale en ile yanıtlanır', async () => {
    const { body } = await call({ version: '2.2.0', platform: 'ios', locale: 'xx' }, [row]);
    expect(body).toEqual({ item: { id: 'w1', version: '2.2.0', title: 'EN', body: 'b', ctaLabel: null, imageUrl: null } });
  });

  it('tr locale tr metni döner', async () => {
    const { body } = await call({ version: '2.2.0', platform: 'android', locale: 'tr' }, [row]);
    expect((body as any).item).toMatchObject({ title: 'TR', ctaLabel: 'Tamam' });
  });

  it('kayıt yoksa { item: null }', async () => {
    const { body } = await call({ version: '2.3.0', platform: 'ios' }, [row]);
    expect(body).toEqual({ item: null });
  });
});
