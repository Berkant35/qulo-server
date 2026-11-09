import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `ensureStorageBuckets`: soru medyası (ses/görsel) ESKİ KULLANICILARA AÇIK URL ile sızmamalı —
 * `question-media` private; `chat-media` tanımı ise bu işte değişmez.
 */
const createBucket = vi.fn();
const getBucket = vi.fn();

async function calistir() {
  vi.resetModules();
  createBucket.mockReset().mockResolvedValue({ error: null });
  getBucket.mockReset().mockResolvedValue({ data: null });
  vi.doMock('@supabase/supabase-js', () => ({
    createClient: () => ({ storage: { getBucket, createBucket } }),
  }));
  vi.doMock('../../src/config/env.js', () => ({
    env: { SUPABASE_URL: 'http://localhost', SUPABASE_SERVICE_ROLE_KEY: 'x' },
  }));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const { ensureStorageBuckets } = await import('../../src/config/supabase.js');
  await ensureStorageBuckets();
}

function secenekler(id: string) {
  const cagri = createBucket.mock.calls.find((c) => c[0] === id);
  return cagri?.[1];
}

describe('ensureStorageBuckets', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('question-media bucket private, 8MB ve yalniz gorsel/ses MIME ile olusturulur', async () => {
    await calistir();
    expect(secenekler('question-media')).toEqual({
      public: false,
      fileSizeLimit: 8 * 1024 * 1024,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'audio/m4a', 'audio/mp4', 'audio/aac'],
    });
  });

  it('chat-media tanimi degismez (public)', async () => {
    await calistir();
    expect(secenekler('chat-media')).toEqual({
      public: true,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'audio/mp4', 'audio/m4a', 'audio/mpeg', 'audio/aac'],
    });
  });
});
