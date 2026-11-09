import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';

/**
 * Soru medyasi uclari — kablolama sinamasi (gercek Express + multer + errorHandler, fake DB).
 * Kapi (surum >= 2.0.19 VE media_questions_enabled) multer'dan ONCE: kapali istek dosyayi belleğe almaz.
 * Ses ucunda multer siniri 1 MB, gorselde 8 MB; tur listesi uca gore ayri.
 */
const A = '11111111-1111-4111-8111-111111111111';
const QA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NEW_CLIENT = '2.0.19+101';
const M4A = () => Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(64, 1)]);

let close: (() => Promise<void>) | null = null;

async function serve(opts: { flag?: boolean; seed?: Tables; storage?: Record<string, string[]> } = {}) {
  const fake = createFakeSupabase({
    economy_config_versions: [activeConfigRow()],
    app_config: [{ id: 1, media_questions_enabled: opts.flag ?? true }],
    users: [{ id: A, subscription_plan: null }],
    questions: [{ id: QA, user_id: A, order_num: 1, question_text: 'Soru 1', voice_path: null, voice_duration_ms: null, image_path: null, image_status: null }],
    ...opts.seed,
  }, { storage: opts.storage });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  vi.doMock('../../src/middleware/auth.js', () => ({
    authMiddleware: (req: { user?: unknown; headers: Record<string, unknown> }, _res: unknown, next: () => void) => {
      req.user = { userId: req.headers['x-test-user'], email: 'x@qulo.test' };
      next();
    },
  }));

  const express = (await import('express')).default;
  const routes = (await import('../../src/routes/question.routes.js')).default;
  const { errorHandler } = await import('../../src/middleware/errorHandler.js');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/questions', routes);
  app.use(errorHandler);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  const { port } = server.address() as AddressInfo;
  return { fake, base: `http://127.0.0.1:${port}/api/v1/questions` };
}

function form(file: Buffer, mime: string, fields: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(file)], { type: mime }), 'f.bin');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

const send = (url: string, body: FormData, version = NEW_CLIENT, method = 'POST') =>
  fetch(url, { method, headers: { 'x-test-user': A, 'x-app-version': version }, body });

async function errorCode(res: Response): Promise<string | undefined> {
  const text = await res.text();
  try { return (JSON.parse(text) as { error?: { code?: string } }).error?.code; } catch { return undefined; }
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  await close?.();
  close = null;
  vi.doUnmock('../../src/middleware/auth.js');
  vi.restoreAllMocks();
});

describe('POST /questions/me/:order/voice', () => {
  it('yeni istemci + bayrak acik → 201, OwnerQuestionMedia doner, dosya yazilir', async () => {
    const { base, fake } = await serve();

    const res = await send(`${base}/me/1/voice`, form(M4A(), 'audio/m4a', { duration_ms: '4200' }));

    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ voice_duration_ms: 4200, image_url: null, image_status: null });
    expect(String(body.voice_url)).toContain(`question-media/${A}/${QA}/voice-`);
    expect(fake.storageFiles('question-media')).toHaveLength(1);
  });

  it('bayrak kapali → 403 FEATURE_DISABLED, dosya yazilmaz', async () => {
    const { base, fake } = await serve({ flag: false });
    const res = await send(`${base}/me/1/voice`, form(M4A(), 'audio/m4a', { duration_ms: '4200' }));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('FEATURE_DISABLED');
    expect(fake.storageFiles('question-media')).toEqual([]);
  });

  it('eski istemci (2.0.18) → 403 FEATURE_DISABLED', async () => {
    const { base } = await serve();
    const res = await send(`${base}/me/1/voice`, form(M4A(), 'audio/m4a', { duration_ms: '4200' }), '2.0.18+100');
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('FEATURE_DISABLED');
  });

  it('duration_ms 15 001 → 400 VALIDATION_ERROR', async () => {
    const { base, fake } = await serve();
    const res = await send(`${base}/me/1/voice`, form(M4A(), 'audio/m4a', { duration_ms: '15001' }));
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION_ERROR');
    expect(fake.storageFiles('question-media')).toEqual([]);
  });

  it('duration_ms eksik → 400 VALIDATION_ERROR', async () => {
    const { base } = await serve();
    const res = await send(`${base}/me/1/voice`, form(M4A(), 'audio/m4a'));
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION_ERROR');
  });

  it('audio/mpeg → 400 INVALID_FILE_TYPE', async () => {
    const { base } = await serve();
    const res = await send(`${base}/me/1/voice`, form(M4A(), 'audio/mpeg', { duration_ms: '3000' }));
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('INVALID_FILE_TYPE');
  });

  it('ses ucuna gorsel turu → 400 INVALID_FILE_TYPE', async () => {
    const { base } = await serve();
    const res = await send(`${base}/me/1/voice`, form(M4A(), 'image/jpeg', { duration_ms: '3000' }));
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('INVALID_FILE_TYPE');
  });

  it('1 MB ustu ses → 413 PAYLOAD_TOO_LARGE (multer siniri)', async () => {
    const { base, fake } = await serve();
    const big = Buffer.concat([M4A(), Buffer.alloc(1024 * 1024)]);
    const res = await send(`${base}/me/1/voice`, form(big, 'audio/m4a', { duration_ms: '3000' }));
    expect(res.status).toBe(413);
    expect(await errorCode(res)).toBe('PAYLOAD_TOO_LARGE');
    expect(fake.storageFiles('question-media')).toEqual([]);
  });

  it('dosyasiz istek → 400 VALIDATION_ERROR', async () => {
    const { base } = await serve();
    const fd = new FormData();
    fd.append('duration_ms', '3000');
    const res = await send(`${base}/me/1/voice`, fd);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION_ERROR');
  });

  it('gecersiz sira (abc) → 400 VALIDATION_ERROR', async () => {
    const { base } = await serve();
    const res = await send(`${base}/me/abc/voice`, form(M4A(), 'audio/m4a', { duration_ms: '3000' }));
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION_ERROR');
  });

  it('kullanicinin olmayan sorusu → 404 QUESTION_NOT_FOUND', async () => {
    const { base } = await serve();
    const res = await send(`${base}/me/5/voice`, form(M4A(), 'audio/m4a', { duration_ms: '3000' }));
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe('QUESTION_NOT_FOUND');
  });
});

describe('POST /questions/me/:order/image', () => {
  it('bayrak kapali → 403 FEATURE_DISABLED', async () => {
    const { base } = await serve({ flag: false });
    const res = await send(`${base}/me/1/image`, form(Buffer.from('x'), 'image/png'));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('FEATURE_DISABLED');
  });

  it('gorsel ucuna ses turu → 400 INVALID_FILE_TYPE', async () => {
    const { base } = await serve();
    const res = await send(`${base}/me/1/image`, form(M4A(), 'audio/m4a'));
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('INVALID_FILE_TYPE');
  });
});

describe('DELETE /questions/me/:order/media/:kind', () => {
  const voice = `${A}/${QA}/voice-1.m4a`;
  const withVoice = { questions: [{ id: QA, user_id: A, order_num: 1, question_text: 'Soru 1', voice_path: voice, voice_duration_ms: 1000, image_path: null, image_status: null }] };

  it('sesi siler — kapi kapali olsa da kendi verisini kaldirabilir', async () => {
    const { base, fake } = await serve({ flag: false, seed: withVoice, storage: { 'question-media': [voice] } });

    const res = await fetch(`${base}/me/1/media/voice`, { method: 'DELETE', headers: { 'x-test-user': A } });

    expect(res.status).toBe(200);
    expect(fake.storageFiles('question-media')).toEqual([]);
    expect(fake.table('questions')[0]).toMatchObject({ voice_path: null, voice_duration_ms: null });
  });

  it('gecersiz tur → 400 VALIDATION_ERROR', async () => {
    const { base } = await serve();
    const res = await fetch(`${base}/me/1/media/video`, { method: 'DELETE', headers: { 'x-test-user': A } });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION_ERROR');
  });
});

describe('GET /questions/me', () => {
  it('medya alanlarini imzali URL ile doner', async () => {
    const voice = `${A}/${QA}/voice-1.m4a`;
    const { base } = await serve({
      seed: { questions: [{ id: QA, user_id: A, order_num: 1, question_text: 'Soru 1', voice_path: voice, voice_duration_ms: 1000, image_path: null, image_status: null }] },
      storage: { 'question-media': [voice] },
    });

    const res = await fetch(`${base}/me`, { headers: { 'x-test-user': A } });

    expect(res.status).toBe(200);
    const [row] = await res.json() as Array<Record<string, unknown>>;
    expect(row).toMatchObject({ voice_duration_ms: 1000, image_url: null });
    expect(String(row.voice_url)).toContain(voice);
    expect(row).not.toHaveProperty('voice_path');
  });
});
