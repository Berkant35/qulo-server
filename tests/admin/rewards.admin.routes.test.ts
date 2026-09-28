import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable } from 'node:stream';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

/**
 * Rainbow backoffice rotalarının güvenlik dizilimi (global kısıt: her POST `csrfValidate`; multipart gövde
 * `csrfValidate`'ten ÖNCE multer ile çözülür). Handler'lar test edilmez — yalnız `router.stack` yapısı:
 * bir POST'tan `csrfValidate` düşerse ya da multer onun ARKASINA kayarsa (token boş gövdede aranır, her
 * kart formu 403 olur) burası kırmızıya döner.
 */

type Layer = { name: string; handle: unknown };
type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: Layer[] } };

const SID = '6b3f2a1e-9c4d-4e5f-8a7b-1c2d3e4f5a6b';

/** Sayfa bölümleri POST rotaları (spec 2026-09-28 §6) — biri eksilirse/eklenirse liste bilinçli güncellenir. */
const SECTION_POSTS = [
  '/sections',
  '/sections/:id',
  '/sections/:id/status',
  '/sections/:id/move',
  '/sections/:id/delete',
  '/sections/:id/items',
  '/sections/:id/items/:itemId',
  '/sections/:id/items/:itemId/active',
  '/sections/:id/items/:itemId/move',
  '/sections/:id/items/:itemId/delete',
];
const MULTIPART_POSTS = ['/sections/:id/items', '/sections/:id/items/:itemId'];

async function load() {
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: createFakeSupabase().client }));
  const { default: router, cardForm } = await import('../../src/admin/rewards.admin.routes.js');
  const { csrfValidate } = await import('../../src/admin/admin.middleware.js');
  const posts = (router as unknown as { stack: RouteLayer[] }).stack
    .filter((layer) => layer.route?.methods.post)
    .map((layer) => ({ path: layer.route!.path, handlers: layer.route!.stack.map((l) => l.handle) }));
  return { posts, cardForm, csrfValidate };
}

/** Gerçek multipart gövde akışı: multer `req`'i okur (busboy), sonra `res`/`next`'e karar verir. */
function multipartReq(file: Buffer, params: Record<string, string>) {
  const boundary = '----qulotest';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="_csrf"\r\n\r\ntok\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="b.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const req = Readable.from([body]) as Readable & Record<string, unknown>;
  req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length) };
  req.params = params;
  return req as any;
}

function runCardForm(cardForm: (req: any, res: any, next: any) => void, req: any) {
  return new Promise<{ redirectedTo: string | null; nextCalled: boolean }>((resolve) => {
    const res = { redirect: (url: string) => resolve({ redirectedTo: url, nextCalled: false }) };
    cardForm(req, res, () => resolve({ redirectedTo: null, nextCalled: true }));
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rewards.admin.routes — POST güvenlik dizilimi', () => {
  it('her POST rotası csrfValidate içerir ve son handler\'dan önce çalışır', async () => {
    const { posts, csrfValidate } = await load();
    expect(posts.length).toBeGreaterThan(0);
    const missing = posts.filter((p) => {
      const at = p.handlers.indexOf(csrfValidate);
      return at < 0 || at >= p.handlers.length - 1;
    });
    expect(missing.map((p) => p.path)).toEqual([]);
  });

  it('sayfa bölümleri POST rotalarının hiçbiri eksik değil', async () => {
    const { posts } = await load();
    const sectionPosts = posts.map((p) => p.path).filter((path) => path.startsWith('/sections'));
    expect(sectionPosts.sort()).toEqual([...SECTION_POSTS].sort());
  });

  it('kart formu (multipart) rotalarında multer (cardForm) csrfValidate\'ten ÖNCE', async () => {
    const { posts, cardForm, csrfValidate } = await load();
    for (const path of MULTIPART_POSTS) {
      const route = posts.find((p) => p.path === path);
      expect(route, path).toBeDefined();
      const multerAt = route!.handlers.indexOf(cardForm);
      expect(multerAt, path).toBeGreaterThanOrEqual(0);
      expect(multerAt, path).toBeLessThan(route!.handlers.indexOf(csrfValidate));
    }
    // Multipart olmayan rotalarda multer yok (JSON/urlencoded gövde zaten üst router'da çözülür).
    const others = posts.filter((p) => !MULTIPART_POSTS.includes(p.path));
    expect(others.filter((p) => p.handlers.includes(cardForm)).map((p) => p.path)).toEqual([]);
  });
});

describe('cardForm — multer hata dalı', () => {
  it('geçerli küçük dosya: gövde (csrf dahil) ve dosya çözülür, next çağrılır', async () => {
    const { cardForm } = await load();
    const req = multipartReq(Buffer.from([0xff, 0xd8, 0xff, 0x00]), { id: SID });
    const result = await runCardForm(cardForm, req);
    expect(result).toEqual({ redirectedTo: null, nextCalled: true });
    expect(req.body._csrf).toBe('tok');
    expect(req.file.buffer.length).toBe(4);
  });

  it('8 MB\'tan büyük dosya: bölüm sayfasına ?error=image_invalid, next çağrılmaz', async () => {
    const { cardForm } = await load();
    const tooBig = Buffer.alloc(8 * 1024 * 1024 + 1, 0x61);
    const result = await runCardForm(cardForm, multipartReq(tooBig, { id: SID }));
    expect(result).toEqual({ redirectedTo: `/admin/rewards/sections/${SID}?error=image_invalid`, nextCalled: false });
  });

  it('yönlendirme :id parametresini URL-kodlar', async () => {
    const { cardForm } = await load();
    const tooBig = Buffer.alloc(8 * 1024 * 1024 + 1, 0x61);
    const result = await runCardForm(cardForm, multipartReq(tooBig, { id: 'a/b?c' }));
    expect(result.redirectedTo).toBe('/admin/rewards/sections/a%2Fb%3Fc?error=image_invalid');
  });
});
