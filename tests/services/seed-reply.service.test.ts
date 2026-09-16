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

const kapaliSatir = (over: Record<string, unknown> = {}) => ({
  id: 'q0', match_id: MATCH, seed_user_id: SEED, trigger_message_id: null,
  question_id: null, kind: 'message', reply_due_at: '2026-09-16T10:01:00Z',
  attempts: 3, updated_at: new Date().toISOString(), ...over,
});


/** Son mesaj INSAN olacak sekilde n mesajlik sohbet (bot cift, insan tek indekste). */
const sohbet = (n: number) => Array.from({ length: n }, (_, i) =>
  mesaj(`m${i}`, i % 2 === 0 ? SEED : INSAN, { created_at: `2026-09-16T10:${String(i).padStart(2, '0')}:00Z` }));

/** Faz 4 kurgusu: bot TEK indekste, boylece 26. mesaj (index 25) botun kapanisi olabilir. */
const faz4Sohbet = (n: number) => Array.from({ length: n }, (_, i) =>
  mesaj(`m${i}`, i % 2 === 1 ? SEED : INSAN, { created_at: `2026-09-16T10:${String(i).padStart(2, '0')}:00Z` }));

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

  // IMPORTANT 6: discover kapisi `is_test_account` filtreliyor, bot `is_seed_profile`
  // hedefliyordu. Bugun ortusuyorlar ama bunu zorlayan kisit yoktu: bir seed'de
  // `is_test_account=false` yapilirsa profil gercek kullanicilara acilir VE bot hala yazar.
  it('is_test_account=false olan seed profile satir ACMAZ', async () => {
    const { fake, svc } = await setup({
      users: [
        { id: SEED, is_seed_profile: true, is_test_account: false, seed_persona: persona, name: 'Elif' },
        { id: INSAN, is_seed_profile: false, is_test_account: false, is_test_admin: true, name: 'Berkant' },
      ],
    });
    expect(await svc.scanAndEnqueue()).toBe(0);
    expect(fake.table('seed_reply_queue')).toHaveLength(0);
  });

  // CRITICAL 2: `failed` satir acik-satir filtresine (pending/claimed) girmiyor ve
  // insanin mesaji hala son mesaj oldugu icin tarama her tikte YENI satir aciyordu.
  it('yakin zamanda failed olmus eslesmeye yeni satir ACMAZ', async () => {
    const { fake, svc } = await setup({ seed_reply_queue: [kapaliSatir({ status: 'failed' })] });
    expect(await svc.scanAndEnqueue()).toBe(0);
    expect(fake.table('seed_reply_queue')).toHaveLength(1);
  });

  it('soguma penceresi disinda kalan failed satir yeni cevabi engellemez', async () => {
    const { svc } = await setup({
      seed_reply_queue: [kapaliSatir({
        status: 'failed', updated_at: new Date(Date.now() - 7 * 60 * 60_000).toISOString(),
      })],
    });
    expect(await svc.scanAndEnqueue()).toBe(1);
  });

  it('18 yas alti yuzunden iptal edilen TETIKLEYICI mesaj yeniden kuyruga girmez', async () => {
    const { fake, svc } = await setup({
      seed_reply_queue: [kapaliSatir({
        status: 'cancelled', trigger_message_id: 'm1', last_error: '18 yas alti beyani',
      })],
    });
    expect(await svc.scanAndEnqueue()).toBe(0);
    expect(fake.table('seed_reply_queue')).toHaveLength(1);
  });

  it('iptal edilen satir BASKA bir insan mesajini engellemez (eslesme susturulmaz)', async () => {
    const { svc } = await setup({
      messages: [mesaj('m1', INSAN), mesaj('m2', INSAN, { created_at: '2026-09-16T10:05:00Z' })],
      seed_reply_queue: [kapaliSatir({ status: 'cancelled', trigger_message_id: 'm1' })],
    });
    expect(await svc.scanAndEnqueue()).toBe(1);
  });

  it('parca sinirini asan seed sayisinda ikinci parcadaki eslesmeyi de bulur', async () => {
    const cokSeed = Array.from({ length: 120 }, (_, i) => ({
      id: `seed-${String(i).padStart(3, '0')}`, is_seed_profile: true, is_test_account: true,
      seed_persona: persona, name: 'S',
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

describe('scanAndEnqueue — soru uretici (spec §6.1)', () => {
  // `kind: 'question'` uretici hic yoktu: askQuestion, cron dali, LLM soru uretimi ve
  // testleri vardi ama hicbir yer satir INSERT etmiyordu → uretimde ulasilamaz kod.
  it('faz 1 son ucte birinde zar tutunca soru satiri acar (metin cevabinin YERINE)', async () => {
    const { fake, svc } = await setup({ messages: sohbet(8) });
    expect(await svc.scanAndEnqueue(new Date(), () => 0.1)).toBe(1);
    const satirlar = fake.table('seed_reply_queue');
    expect(satirlar).toHaveLength(1);           // ikisi birden DEGIL
    expect(satirlar[0]!.kind).toBe('question');
  });

  it('zar tutmazsa metin cevabi satiri acilir', async () => {
    const { fake, svc } = await setup({ messages: sohbet(8) });
    expect(await svc.scanAndEnqueue(new Date(), () => 0.9)).toBe(1);
    expect(fake.table('seed_reply_queue')[0]!.kind).toBe('message');
  });

  it('faz 1 son ucte biri disinda zar tutsa da soru acilmaz', async () => {
    const { fake, svc } = await setup({ messages: sohbet(4) });
    await svc.scanAndEnqueue(new Date(), () => 0.1);
    expect(fake.table('seed_reply_queue')[0]!.kind).toBe('message');
  });

  it('o eslesmede bugunku soru kotasi doluysa soru acilmaz', async () => {
    const bugun = new Date().toISOString();
    const soruldu = (id: string) => ({
      id, match_id: MATCH, sender_id: SEED, answered_option: 'A',
      is_abandoned: false, created_at: bugun,
    });
    const { fake, svc } = await setup({
      messages: sohbet(8),
      chat_questions: [soruldu('sq1'), soruldu('sq2')],
    });
    await svc.scanAndEnqueue(new Date(), () => 0.1);
    expect(fake.table('seed_reply_queue')[0]!.kind).toBe('message');
  });
});

describe('scanAndEnqueue — faz 4 kapanisi (spec §5)', () => {
  it('faz 4 esigine ulasmis ama kapanis GONDERILMEMIS eslesmeye satir acilir', async () => {
    const { svc } = await setup({ messages: faz4Sohbet(25) });
    expect(await svc.scanAndEnqueue(new Date(), () => 0.9)).toBe(1);
  });

  it('kapanis mesaji bir kez gonderildikten sonra YENI satir acilmaz', async () => {
    const { fake, svc } = await setup({ messages: faz4Sohbet(27) });
    expect(await svc.scanAndEnqueue(new Date(), () => 0.9)).toBe(0);
    expect(fake.table('seed_reply_queue')).toHaveLength(0);
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
