import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

const SEED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MATCH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOW = new Date('2026-09-16T12:00:00Z');

const botMesaji = (i: number, dakikaOnce: number, matchId = MATCH) => ({
  id: `bm${i}`, match_id: matchId, sender_id: SEED, content: 'x', deleted_at: null,
  created_at: new Date(NOW.getTime() - dakikaOnce * 60_000).toISOString(),
});

async function setup(messages: Record<string, unknown>[]) {
  const fake = createFakeSupabase({ messages });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  return import('../../src/services/seed-reply.service.js');
}

beforeEach(() => vi.resetModules());

describe('withinRateLimits', () => {
  it('normal trafikte gecer', async () => {
    const svc = await setup([botMesaji(1, 5), botMesaji(2, 30)]);
    expect(await svc.withinRateLimits(MATCH, SEED, NOW)).toBe(true);
  });

  it('eslesme basina gunluk 40 mesaj tavaninda durur', async () => {
    const svc = await setup(Array.from({ length: 40 }, (_, i) => botMesaji(i, 60 + i)));
    expect(await svc.withinRateLimits(MATCH, SEED, NOW)).toBe(false);
  });

  it('profil basina saatlik 12 mesaj tavaninda durur (farkli eslesmeler dahil)', async () => {
    const svc = await setup(Array.from({ length: 12 }, (_, i) => botMesaji(i, i + 1, `match-${i}`)));
    expect(await svc.withinRateLimits('yeni-match', SEED, NOW)).toBe(false);
  });
});
