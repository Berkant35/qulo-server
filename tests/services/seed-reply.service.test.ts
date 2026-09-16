import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';

const SEED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSAN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MATCH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const persona = {
  responder_type: 'anlik', work_pattern: 'esnek',
  sleep_window: { start_min: 30, end_min: 450 },
  style: { uzunluk: 'kisa', emoji: 'nadiren', yazim: 'kucuk_harf', enerji: 'kisa_kesen' },
  derived_at: '2026-09-16T00:00:00Z', model: 'test',
};

const mesaj = (id: string, sender: string, over: Record<string, unknown> = {}) => ({
  id, match_id: MATCH, sender_id: sender, content: 'selam', is_image: false,
  deleted_at: null, created_at: '2026-09-16T10:00:00Z', ...over,
});

async function setup(seed: Tables = {}) {
  const fake = createFakeSupabase({
    users: [
      { id: SEED, is_seed_profile: true, is_test_account: true, seed_persona: persona, name: 'Elif' },
      { id: INSAN, is_seed_profile: false, is_test_account: false, is_test_admin: true, name: 'Berkant' },
    ],
    matches: [{ id: MATCH, user1_id: SEED, user2_id: INSAN, is_active: true }],
    messages: [mesaj('m1', INSAN)],
    seed_reply_queue: [],
    ...seed,
  }, { rpc: { claim_seed_replies: { data: [] } } });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const svc = await import('../../src/services/seed-reply.service.js');
  return { fake, svc };
}

beforeEach(() => vi.resetModules());

describe('scanAndEnqueue', () => {
  it('son mesaji insan atmissa kuyruga satir ekler', async () => {
    const { fake, svc } = await setup();
    expect(await svc.scanAndEnqueue()).toBe(1);
    const satir = fake.table('seed_reply_queue')[0]!;
    expect(satir).toMatchObject({ match_id: MATCH, seed_user_id: SEED, kind: 'message', status: 'pending' });
  });

  it('son mesaji bot atmissa satir eklemez', async () => {
    const { fake, svc } = await setup({
      messages: [mesaj('m1', INSAN), mesaj('m2', SEED, { created_at: '2026-09-16T10:05:00Z' })],
    });
    expect(await svc.scanAndEnqueue()).toBe(0);
    expect(fake.table('seed_reply_queue')).toHaveLength(0);
  });

  it('SILINMIS mesaji son mesaj saymaz', async () => {
    // Insanin son mesaji silinmis; ondan onceki bot mesaji → cevap yazilmamali.
    const { fake, svc } = await setup({
      messages: [
        mesaj('m1', SEED, { created_at: '2026-09-16T10:00:00Z' }),
        mesaj('m2', INSAN, { created_at: '2026-09-16T10:05:00Z', deleted_at: '2026-09-16T10:06:00Z' }),
      ],
    });
    expect(await svc.scanAndEnqueue()).toBe(0);
    expect(fake.table('seed_reply_queue')).toHaveLength(0);
  });

  it('__QUESTION__ mesajini metin cevabi olarak kuyruga almaz', async () => {
    const { fake, svc } = await setup({ messages: [mesaj('m1', INSAN, { content: '__QUESTION__:q1' })] });
    await svc.scanAndEnqueue();
    expect(fake.table('seed_reply_queue').filter((r) => r.kind === 'message')).toHaveLength(0);
  });

  it('pasif eslesmeyi atlar', async () => {
    const { fake, svc } = await setup({ matches: [{ id: MATCH, user1_id: SEED, user2_id: INSAN, is_active: false }] });
    expect(await svc.scanAndEnqueue()).toBe(0);
    expect(fake.table('seed_reply_queue')).toHaveLength(0);
  });

  it('seed OLMAYAN iki kullanicinin eslesmesine asla satir acmaz', async () => {
    const { fake, svc } = await setup({
      users: [
        { id: SEED, is_seed_profile: false, is_test_account: false },
        { id: INSAN, is_seed_profile: false, is_test_account: false },
      ],
    });
    expect(await svc.scanAndEnqueue()).toBe(0);
    expect(fake.table('seed_reply_queue')).toHaveLength(0);
  });

  it('acik satir varken ikinci satir acmaz (mukerrer cevap korumasi)', async () => {
    const { fake, svc } = await setup({
      seed_reply_queue: [{ id: 'q1', match_id: MATCH, seed_user_id: SEED, kind: 'message', status: 'pending', reply_due_at: '2026-09-16T10:01:00Z', attempts: 0 }],
    });
    expect(await svc.scanAndEnqueue()).toBe(0);
    expect(fake.table('seed_reply_queue')).toHaveLength(1);
  });

  it('parca sinirini asan seed sayisinda ikinci parcadaki eslesmeyi de bulur', async () => {
    const cokSeed = Array.from({ length: 120 }, (_, i) => ({
      id: `seed-${String(i).padStart(3, '0')}`, is_seed_profile: true, seed_persona: persona, name: 'S',
    }));
    const gecSeed = cokSeed[110]!.id as string;   // ID_PARCA=100 → ikinci parca
    const { fake, svc } = await setup({
      users: [...cokSeed, { id: INSAN, is_seed_profile: false, is_test_admin: true, name: 'Berkant' }],
      matches: [{ id: MATCH, user1_id: gecSeed, user2_id: INSAN, is_active: true }],
      messages: [mesaj('m1', INSAN)],
    });
    expect(await svc.scanAndEnqueue()).toBe(1);
    expect(fake.table('seed_reply_queue')[0]).toMatchObject({ match_id: MATCH, seed_user_id: gecSeed });
  });
});

describe('claimDue', () => {
  it('claim islemini RPC uzerinden yapar (surec ici bayrakla degil)', async () => {
    const { fake, svc } = await setup();
    await svc.claimDue(5);
    expect(fake.rpcCalls).toContainEqual({ name: 'claim_seed_replies', args: { p_limit: 5 } });
  });
});

describe('durum gecisleri', () => {
  const kuyruk = [{ id: 'q1', match_id: MATCH, seed_user_id: SEED, kind: 'message', status: 'claimed', reply_due_at: '2026-09-16T10:01:00Z', attempts: 1 }];

  it('markSent satiri sent yapar', async () => {
    const { fake, svc } = await setup({ seed_reply_queue: [...kuyruk] });
    await svc.markSent('q1');
    expect(fake.table('seed_reply_queue')[0]!.status).toBe('sent');
  });

  it('markFailed hatayi yazar', async () => {
    const { fake, svc } = await setup({ seed_reply_queue: [...kuyruk] });
    await svc.markFailed('q1', 'gemini timeout');
    expect(fake.table('seed_reply_queue')[0]).toMatchObject({ status: 'failed', last_error: 'gemini timeout' });
  });

  it('deferRow satiri pending\'e dondurur ve vakti oteler', async () => {
    const { fake, svc } = await setup({ seed_reply_queue: [...kuyruk] });
    await svc.deferRow('q1', 120_000);
    const satir = fake.table('seed_reply_queue')[0]!;
    expect(satir.status).toBe('pending');
    expect(new Date(satir.reply_due_at as string).getTime()).toBeGreaterThan(Date.now());
  });
});
