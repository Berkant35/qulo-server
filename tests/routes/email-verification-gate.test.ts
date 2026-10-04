import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import type { Router } from 'express';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';

/**
 * "Önce içeri al, doğrulamayı ilk mesajdan önce iste" (2026-10-04) — kablolama sınaması.
 * Gerçek Express + errorHandler loopback'te; kimlik `x-test-user` başlığından (sahte authMiddleware),
 * DB fake. Kapı (emailVerifiedGuard) gerçek: eşleşmeye YAZAN uçlar doğrulama ister, okuyanlar istemez.
 */
const UNVERIFIED = '11111111-1111-4111-8111-111111111111';
const VERIFIED = '22222222-2222-4222-8222-222222222222';
const MATCH = '33333333-3333-4333-8333-333333333333';

let close: (() => Promise<void>) | null = null;
const sentVerification: string[] = [];

async function serve(mount: 'chat' | 'auth', seed: Tables = {}) {
  const fake = createFakeSupabase({
    economy_config_versions: [activeConfigRow()],
    users: [
      { id: UNVERIFIED, email: 'yeni@qulo.test', locale: 'tr', email_verified: false, is_deleted: false, is_banned: false },
      { id: VERIFIED, email: 'eski@qulo.test', locale: 'tr', email_verified: true, is_deleted: false, is_banned: false },
    ],
    matches: [{ id: MATCH, user1_id: UNVERIFIED, user2_id: VERIFIED, is_active: true }],
    messages: [],
    chat_questions: [],
    media_requests: [],
    ...seed,
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  vi.doMock('../../src/utils/email.js', () => ({
    sendVerificationEmail: async (email: string) => { sentVerification.push(email); },
    sendPasswordResetEmail: async () => {},
  }));
  vi.doMock('../../src/middleware/auth.js', () => ({
    authMiddleware: (req: { user?: unknown; headers: Record<string, unknown> }, _res: unknown, next: () => void) => {
      req.user = { userId: req.headers['x-test-user'], email: 'x@qulo.test' };
      next();
    },
  }));

  const express = (await import('express')).default;
  const routes: Router = mount === 'chat'
    ? (await import('../../src/routes/chat.routes.js')).default
    : (await import('../../src/routes/auth.routes.js')).default;
  const { errorHandler } = await import('../../src/middleware/errorHandler.js');
  const app = express();
  app.use(express.json());
  app.use(`/api/v1/${mount}`, routes);
  app.use(errorHandler);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  const { port } = server.address() as AddressInfo;
  return { fake, base: `http://127.0.0.1:${port}/api/v1/${mount}` };
}

const post = (url: string, user: string, body: unknown = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': user }, body: JSON.stringify(body) });

async function errorCode(res: Response): Promise<string | undefined> {
  const text = await res.text();
  try { return (JSON.parse(text) as { error?: { code?: string } }).error?.code; } catch { return undefined; }
}

beforeEach(() => {
  vi.resetModules();
  sentVerification.length = 0;
});

afterEach(async () => {
  await close?.();
  close = null;
  vi.doUnmock('../../src/middleware/auth.js');
  vi.doUnmock('../../src/utils/email.js');
});

describe('sohbet — e-posta doğrulama kapısı', () => {
  it.each([
    ['mesaj', `/${MATCH}/messages`, { content: 'merhaba' }],
    ['medya yükleme', `/${MATCH}/upload`, {}],
    ['soru medyası yükleme', `/${MATCH}/question-upload`, {}],
    ['sohbet sorusu gönderme', `/${MATCH}/questions`, {}],
    ['medya isteği', `/${MATCH}/media-request`, {}],
  ])('doğrulanmamış kullanıcı %s ucunda 403 EMAIL_VERIFICATION_REQUIRED alır, hiçbir şey yazılmaz', async (_ad, path, body) => {
    const { base, fake } = await serve('chat');

    const res = await post(`${base}${path}`, UNVERIFIED, body);

    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect(fake.table('messages')).toHaveLength(0);
    expect(fake.table('chat_questions')).toHaveLength(0);
    expect(fake.table('media_requests')).toHaveLength(0);
  });

  it('doğrulanmış kullanıcı kapıdan geçer ve mesaj yazılır', async () => {
    const { base, fake } = await serve('chat');

    const res = await post(`${base}/${MATCH}/messages`, VERIFIED, { content: 'merhaba' });

    expect(res.status).toBeLessThan(300);
    expect(fake.table('messages')).toEqual([expect.objectContaining({ sender_id: VERIFIED, content: 'merhaba' })]);
  });

  it('okuma uçları doğrulama istemez (mesaj listesi, okundu)', async () => {
    const { base } = await serve('chat');

    const list = await fetch(`${base}/${MATCH}/messages`, { headers: { 'x-test-user': UNVERIFIED } });
    expect(list.status).toBe(200);
    const read = await post(`${base}/${MATCH}/read`, UNVERIFIED);
    expect(read.status).toBeLessThan(300);
  });

  it('doğrulama sonrası kapı hemen açılır — olumsuz sonuç önbelleğe yazılmaz', async () => {
    const { base, fake } = await serve('chat');

    expect((await post(`${base}/${MATCH}/messages`, UNVERIFIED, { content: 'a' })).status).toBe(403);
    fake.table('users').find((u) => u.id === UNVERIFIED)!.email_verified = true;

    const res = await post(`${base}/${MATCH}/messages`, UNVERIFIED, { content: 'b' });
    expect(res.status).toBeLessThan(300);
    expect(fake.table('messages')).toHaveLength(1);
  });
});

describe('POST /auth/resend-verification', () => {
  it('doğrulanmamış kullanıcıya e-posta gönderir', async () => {
    const { base } = await serve('auth');

    const res = await post(`${base}/resend-verification`, UNVERIFIED);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ emailVerified: false, sent: true });
    expect(sentVerification).toEqual(['yeni@qulo.test']);
  });

  it('doğrulanmış kullanıcıda e-posta gitmez', async () => {
    const { base } = await serve('auth');
    const res = await post(`${base}/resend-verification`, VERIFIED);
    expect(await res.json()).toEqual({ emailVerified: true, sent: false });
    expect(sentVerification).toHaveLength(0);
  });

  it('15 dakikada 3\'ten fazla istek 429 RATE_LIMITED — kullanıcı anahtarlı', async () => {
    const { base } = await serve('auth');

    for (let i = 0; i < 3; i++) expect((await post(`${base}/resend-verification`, UNVERIFIED)).status).toBe(200);
    const fourth = await post(`${base}/resend-verification`, UNVERIFIED);
    expect(fourth.status).toBe(429);
    expect(await errorCode(fourth)).toBe('RATE_LIMITED');
    expect(sentVerification).toHaveLength(3);
    // Başka kullanıcının hakkı ayrı.
    expect((await post(`${base}/resend-verification`, VERIFIED)).status).toBe(200);
  });
});
