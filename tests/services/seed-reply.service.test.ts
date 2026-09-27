import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type SupabaseError, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';
import { seedAdayi } from '../helpers/seed-reply-aday.js';
import type { SeedAdayi } from '../../src/services/seed-reply.service.js';

const SEED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSAN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MATCH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const persona = {
  responder_type: 'anlik', work_pattern: 'esnek',
  sleep_window: { start_min: 30, end_min: 450 },
  style: { uzunluk: 'kisa', emoji: 'nadiren', yazim: 'kucuk_harf', enerji: 'kisa_kesen' },
  derived_at: '2026-09-16T00:00:00Z', model: 'test',
} as SeedAdayi['seed_persona'];

const kapaliSatir = (over: Record<string, unknown> = {}) => ({
  id: 'q0', match_id: MATCH, seed_user_id: SEED, trigger_message_id: null,
  question_id: null, kind: 'message', reply_due_at: '2026-09-16T10:01:00Z',
  attempts: 3, updated_at: new Date().toISOString(), ...over,
});

const aday = (over: Partial<SeedAdayi> = {}) =>
  seedAdayi({ match_id: MATCH, seed_user_id: SEED, insan: INSAN }, { seed_persona: persona, ...over });

/**
 * Tarama artik tek RPC (`seed_reply_candidates`, migration 065/066). Adayin SQL'de belirlenen
 * gercekleri — silinmis mesajin son sayilmamasi, pasif eslesme, seed olmayan / is_test_account
 * =false profil, acik satirli eslesme, kapanis, gonderen filtresi — `scripts/sql-checks/
 * seed-reply-candidates.ts` senaryolarinda (geri alinan islemde, gercek Postgres) sinanir.
 * Burada JS karar mantigi.
 */
async function setup(
  adaylar: SeedAdayi[] = [aday()],
  seed: Tables = {},
  secenek: { rpcHatasi?: SupabaseError } & Pick<FakeSupabaseOptions, 'failOn' | 'unique'> = {},
) {
  const { rpcHatasi, ...fakeSecenek } = secenek;
  const fake = createFakeSupabase({
    app_config: [{ id: 'cfg', seed_reply_enabled: true, seed_reply_fast_mode: false }],
    seed_reply_queue: [],
    ...seed,
  }, {
    ...fakeSecenek,
    rpc: {
      claim_seed_replies: { data: [] },
      seed_reply_candidates: rpcHatasi ? { error: rpcHatasi } : { data: adaylar },
    },
  });
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
    expect(satir).toMatchObject({
      match_id: MATCH, seed_user_id: SEED, kind: 'message', status: 'pending', trigger_message_id: 'm1',
    });
  });

  it('son mesaji bot atmissa satir eklemez', async () => {
    const { fake, svc } = await setup([aday({ last_message_sender_id: SEED })]);
    expect(await svc.scanAndEnqueue()).toBe(0);
    expect(fake.table('seed_reply_queue')).toHaveLength(0);
  });

  it('__QUESTION__ isaretli son mesaji metin cevabi olarak kuyruga almaz', async () => {
    const { fake, svc } = await setup([aday({ last_message_is_question: true })]);
    expect(await svc.scanAndEnqueue()).toBe(0);
    expect(fake.table('seed_reply_queue')).toHaveLength(0);
  });

  it('mesaji olmayan eslesmeye satir acmaz', async () => {
    const { fake, svc } = await setup([aday({ last_message_id: null, last_message_sender_id: null, message_count: 0 })]);
    expect(await svc.scanAndEnqueue()).toBe(0);
    expect(fake.table('seed_reply_queue')).toHaveLength(0);
  });

  // CRITICAL 2: `failed` satir acik-satir filtresine (pending/claimed) girmiyor ve
  // insanin mesaji hala son mesaj oldugu icin tarama her tikte YENI satir aciyordu.
  it('yakin zamanda failed olmus eslesmeye yeni satir ACMAZ', async () => {
    const { fake, svc } = await setup(undefined, { seed_reply_queue: [kapaliSatir({ status: 'failed' })] });
    expect(await svc.scanAndEnqueue()).toBe(0);
    expect(fake.table('seed_reply_queue')).toHaveLength(1);
  });

  it('soguma penceresi disinda kalan failed satir yeni cevabi engellemez', async () => {
    const { svc } = await setup(undefined, {
      seed_reply_queue: [kapaliSatir({
        status: 'failed', updated_at: new Date(Date.now() - 7 * 60 * 60_000).toISOString(),
      })],
    });
    expect(await svc.scanAndEnqueue()).toBe(1);
  });

  it('18 yas alti yuzunden iptal edilen TETIKLEYICI mesaj yeniden kuyruga girmez', async () => {
    const { fake, svc } = await setup(undefined, {
      seed_reply_queue: [kapaliSatir({
        status: 'cancelled', trigger_message_id: 'm1', last_error: '18 yas alti beyani',
      })],
    });
    expect(await svc.scanAndEnqueue()).toBe(0);
    expect(fake.table('seed_reply_queue')).toHaveLength(1);
  });

  it('iptal edilen satir BASKA bir insan mesajini engellemez (eslesme susturulmaz)', async () => {
    const { svc } = await setup([aday({ last_message_id: 'm2' })], {
      seed_reply_queue: [kapaliSatir({ status: 'cancelled', trigger_message_id: 'm1' })],
    });
    expect(await svc.scanAndEnqueue()).toBe(1);
  });

  it('aday RPC\'si hata verirse FIRLATIR — sessizce "aday yok" sayilmaz', async () => {
    // Bos donen sorgu "is yok" gibi gorunur ve botlar sessizce susar (discover havuzu
    // 2026-09-17'de ayni sessiz-yutma deseniyle herkes icin bosalmisti).
    const { svc } = await setup([], {}, { rpcHatasi: { message: 'function seed_reply_candidates does not exist' } });
    await expect(svc.scanAndEnqueue()).rejects.toBeTruthy();
  });

  it('kapali satirlar okunamazsa FIRLATIR — soguma/iptal filtresi bos sayilip satir acilmaz', async () => {
    // Yutulsaydi: 6 saatlik failed sogumasi ve iptal edilmis tetikleyiciler (18 yas alti)
    // "yok" sayilir, ayni eslesmeye yeniden satir acilir ve LLM cagrisi yakilirdi.
    const { fake, svc } = await setup(undefined, {}, { failOn: [{ table: 'seed_reply_queue', op: 'select' }] });
    await expect(svc.scanAndEnqueue()).rejects.toBeTruthy();
    expect(fake.table('seed_reply_queue')).toHaveLength(0);
  });

  it('bir adayin hatasi digerlerini durdurmaz', async () => {
    // Tek bir seed'in bozuk persona'si (bilinmeyen responder_type → gecikme hesabi TypeError)
    // eskiden tum taramayi her tikte dusururdu; digerleri hic kuyruga giremezdi.
    const bozuk = seedAdayi(
      { match_id: 'bozuk-eslesme', seed_user_id: SEED, insan: INSAN },
      // JSONB kolonu her seyi tasiyabilir: tip sisteminin disindaki bozuk veri bilerek kuruluyor.
      { seed_persona: { ...persona!, responder_type: 'bilinmeyen' } as unknown as SeedAdayi['seed_persona'] },
    );
    const { fake, svc } = await setup([bozuk, aday()]);

    expect(await svc.scanAndEnqueue(new Date(), () => 0.9)).toBe(1);
    expect(fake.table('seed_reply_queue').map((r) => r.match_id)).toEqual([MATCH]);
  });

  it('yarista baska ornek ayni eslesmeye satir actiysa (unique ihlali) sayilmaz, firlatmaz', async () => {
    // RPC acik satirli eslesmeyi dislar ama RPC ile insert arasinda baska bir instance (rolling
    // deploy) satir acabilir; son savunma idx_seed_reply_queue_open_match (059).
    const { fake, svc } = await setup(undefined, {
      seed_reply_queue: [{ id: 'q-yaris', match_id: MATCH, seed_user_id: SEED, kind: 'message', status: 'pending', reply_due_at: '2026-09-27T10:01:00Z', attempts: 0 }],
    }, { unique: { seed_reply_queue: ['match_id'] } });

    expect(await svc.scanAndEnqueue()).toBe(0);
    expect(fake.table('seed_reply_queue')).toHaveLength(1);
  });

  it('soru ve medya istegi birlikte bekliyorsa once SORU cevaplanir, tek satir acilir', async () => {
    const { fake, svc } = await setup([aday({
      pending_question_id: 'soru-1', pending_question_sender_id: INSAN,
      pending_media_request_id: 'istek-1', pending_media_requester_id: INSAN,
    })]);

    expect(await svc.scanAndEnqueue()).toBe(1);
    expect(fake.table('seed_reply_queue')).toEqual([
      expect.objectContaining({ kind: 'question_answer', question_id: 'soru-1' }),
    ]);
  });
});

describe('scanAndEnqueue — istek sayisi (2026-09-27: tik basina ~39 istek, gunde 337 bin)', () => {
  it('aday yoksa RPC disinda HICBIR istek atmaz (bostaki tik)', async () => {
    const { fake, svc } = await setup([]);
    expect(await svc.scanAndEnqueue()).toBe(0);
    expect(fake.queries).toEqual([]);
    // Kapanis esigi spec §5: 25 mesajdan SONRA yazilan seed mesaji kapanistir.
    expect(fake.rpcCalls).toEqual([{ name: 'seed_reply_candidates', args: { p_kapanis_esik: 25 } }]);
  });

  it('aday sayisi artsa da eslesme basina okuma yapmaz (N+1 yok)', async () => {
    const uc = ['m-1', 'm-2', 'm-3'].map((id, i) => seedAdayi(
      { match_id: id, seed_user_id: SEED, insan: INSAN },
      { seed_persona: persona, last_message_id: `son-${i}` },
    ));
    const { fake, svc } = await setup(uc);

    expect(await svc.scanAndEnqueue(new Date(), () => 0.9)).toBe(3);

    // Uc aday icin okuma: kapali satirlar + hizli mod — ikisi de BIR kez.
    expect(fake.queries.filter((q) => q.op === 'select')).toEqual([
      { table: 'seed_reply_queue', op: 'select' },
      { table: 'app_config', op: 'select' },
    ]);
    expect(fake.queries.filter((q) => q.op === 'insert')).toHaveLength(3);
  });
});

describe('scanAndEnqueue — soru uretici (spec §6.1)', () => {
  // `kind: 'question'` uretici hic yoktu: askQuestion, cron dali, LLM soru uretimi ve
  // testleri vardi ama hicbir yer satir INSERT etmiyordu → uretimde ulasilamaz kod.
  it('faz 1 son ucte birinde zar tutunca soru satiri acar (metin cevabinin YERINE)', async () => {
    const { fake, svc } = await setup([aday({ message_count: 8 })]);
    expect(await svc.scanAndEnqueue(new Date(), () => 0.1)).toBe(1);
    const satirlar = fake.table('seed_reply_queue');
    expect(satirlar).toHaveLength(1);           // ikisi birden DEGIL
    expect(satirlar[0]).toMatchObject({ kind: 'question', trigger_message_id: null });
  });

  it('zar tutmazsa metin cevabi satiri acilir', async () => {
    const { fake, svc } = await setup([aday({ message_count: 8 })]);
    expect(await svc.scanAndEnqueue(new Date(), () => 0.9)).toBe(1);
    expect(fake.table('seed_reply_queue')[0]!.kind).toBe('message');
  });

  it('faz 1 son ucte biri disinda zar tutsa da soru acilmaz', async () => {
    const { fake, svc } = await setup([aday({ message_count: 4 })]);
    await svc.scanAndEnqueue(new Date(), () => 0.1);
    expect(fake.table('seed_reply_queue')[0]!.kind).toBe('message');
  });

  it('o eslesmede bugunku soru kotasi doluysa soru acilmaz', async () => {
    const bugun = new Date().toISOString();
    const soruldu = (id: string) => ({
      id, match_id: MATCH, sender_id: SEED, answered_option: 'A',
      is_abandoned: false, created_at: bugun,
    });
    const { fake, svc } = await setup([aday({ message_count: 8 })], {
      chat_questions: [soruldu('sq1'), soruldu('sq2')],
    });
    await svc.scanAndEnqueue(new Date(), () => 0.1);
    expect(fake.table('seed_reply_queue')[0]!.kind).toBe('message');
  });
});

describe('scanAndEnqueue — faz 4 kapanisi (spec §5)', () => {
  it('faz 4 esigine ulasmis ama kapanis GONDERILMEMIS eslesmeye satir acilir', async () => {
    const { svc } = await setup([aday({ message_count: 25, kapanis_gonderildi: false })]);
    expect(await svc.scanAndEnqueue(new Date(), () => 0.9)).toBe(1);
  });

  it('kapanis mesaji bir kez gonderildikten sonra YENI satir acilmaz', async () => {
    const { fake, svc } = await setup([aday({ message_count: 27, kapanis_gonderildi: true })]);
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
    const { fake, svc } = await setup(undefined, { seed_reply_queue: [...kuyruk] });
    await svc.markSent('q1');
    expect(fake.table('seed_reply_queue')[0]!.status).toBe('sent');
  });

  it('markFailed hatayi yazar', async () => {
    const { fake, svc } = await setup(undefined, { seed_reply_queue: [...kuyruk] });
    await svc.markFailed('q1', 'gemini timeout');
    expect(fake.table('seed_reply_queue')[0]).toMatchObject({ status: 'failed', last_error: 'gemini timeout' });
  });

  it('deferRow satiri pending\'e dondurur ve vakti oteler', async () => {
    const { fake, svc } = await setup(undefined, { seed_reply_queue: [...kuyruk] });
    await svc.deferRow('q1', 120_000);
    const satir = fake.table('seed_reply_queue')[0]!;
    expect(satir.status).toBe('pending');
    expect(new Date(satir.reply_due_at as string).getTime()).toBeGreaterThan(Date.now());
  });
});

