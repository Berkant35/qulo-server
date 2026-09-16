import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';

const SEED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSAN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MATCH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'q1', match_id: MATCH, seed_user_id: SEED, trigger_message_id: 'm1',
  question_id: null, kind: 'message', reply_due_at: '2026-09-16T10:01:00Z',
  status: 'claimed', attempts: 1, ...over,
});

async function setup(opts: { seed?: Tables; llm?: string[]; sendThrows?: Error; llmThrows?: Error } = {}) {
  const fake = createFakeSupabase({
    users: [
      { id: SEED, is_seed_profile: true, is_test_account: true, name: 'Elif', age: 31, city: 'Fethiye', bio: 'atölye', seed_persona: null },
      { id: INSAN, is_seed_profile: false, name: 'Berkant' },
    ],
    user_details: [{ user_id: SEED, job: 'Takı tasarımcısı', personality: 'Ambivert' }],
    matches: [{ id: MATCH, user1_id: SEED, user2_id: INSAN, is_active: true }],
    messages: [{ id: 'm1', match_id: MATCH, sender_id: INSAN, content: 'günün nasıl geçti', deleted_at: null, created_at: '2026-09-16T10:00:00Z' }],
    chat_questions: [],
    app_config: [{ id: 'cfg', seed_reply_enabled: true, seed_reply_fast_mode: false }],
    seed_reply_queue: [row()],
    ...opts.seed,
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));

  const cevaplar = [...(opts.llm ?? ['valla atölye yoğundu, zeytin yine tezgâhı işgal etti'])];
  const generateSeedReply = vi.fn(
    async (_istek: { system: string; turns: Array<{ role: 'model' | 'user'; text: string }> }) => {
      if (opts.llmThrows) throw opts.llmThrows;
      return { text: cevaplar.shift() ?? 'tamam', inputTokens: 100, outputTokens: 20 };
    },
  );
  vi.doMock('../../src/services/seed-llm.service.js', () => ({
    generateSeedReply, SEED_LLM_MODEL: 'test-model',
    SeedLlmError: class extends Error { constructor(public code: string, m: string) { super(m); } },
  }));

  const sendMessage = vi.fn<(userId: string, matchId: string, content: string) => Promise<{ id: string }>>(
    async () => { if (opts.sendThrows) throw opts.sendThrows; return { id: 'yeni' }; },
  );
  vi.doMock('../../src/services/chat.service.js', () => ({ chatService: { sendMessage } }));

  const svc = await import('../../src/services/seed-reply.service.js');
  return { fake, svc, sendMessage, generateSeedReply };
}

const hata = (code: string) => Object.assign(new Error(code), { code, status: 403 });

beforeEach(() => vi.resetModules());

describe('processRow', () => {
  it('mutlu yol: uretir, denetimden gecirir, seed kimligiyle gonderir', async () => {
    const { svc, sendMessage, fake } = await setup();
    expect(await svc.processRow(row() as never)).toBe('sent');
    expect(sendMessage).toHaveBeenCalledWith(SEED, MATCH, 'valla atölye yoğundu, zeytin yine tezgâhı işgal etti');
    expect(fake.table('seed_reply_queue')[0]!.status).toBe('sent');
  });

  it('ALICI SEED DEGILSE hicbir sey gondermez (kimlik cift kontrolu)', async () => {
    const { svc, sendMessage } = await setup({
      seed: { users: [{ id: SEED, is_seed_profile: false, name: 'Gercek' }, { id: INSAN, is_seed_profile: false }] },
    });
    expect(await svc.processRow(row() as never)).toBe('cancelled');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('is_test_account=false olan seed profil adina cevap YAZMAZ', async () => {
    const { svc, sendMessage } = await setup({
      seed: {
        users: [
          { id: SEED, is_seed_profile: true, is_test_account: false, name: 'Elif', seed_persona: null },
          { id: INSAN, is_seed_profile: false, name: 'Berkant' },
        ],
      },
    });
    expect(await svc.processRow(row() as never)).toBe('cancelled');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('denetimden gecmeyen ciktiyi bir kez yeniden uretir', async () => {
    const { svc, sendMessage, generateSeedReply } = await setup({
      llm: ['numaram 0532 111 22 33', 'yok ya burada iyiyiz daha'],
    });
    expect(await svc.processRow(row() as never)).toBe('sent');
    expect(generateSeedReply).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledWith(SEED, MATCH, 'yok ya burada iyiyiz daha');
  });

  it('iki denemede de denetimi gecemezse HICBIR SEY gondermez', async () => {
    const { svc, sendMessage } = await setup({ llm: ['numaram 0532 111 22 33', 'instagramım @elif.taki'] });
    expect(await svc.processRow(row({ attempts: 3 }) as never)).toBe('failed');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  // Spec §7: hata/timeout → satir pending'e doner, ustel backoff, 3 denemede failed.
  // `failed` satir acik-satir filtresine girmedigi icin tarama ayni insan mesajina
  // her tikte YENI satir aciyordu: tur basina 2 Gemini cagrisi, sinirsiz.
  it('attempts<3 iken LLM hatasi satiri OLDURMEZ: pending\'e doner (backoff)', async () => {
    const { svc, fake, sendMessage } = await setup({ llmThrows: new Error('timeout') });
    expect(await svc.processRow(row({ attempts: 0 }) as never)).toBe('deferred');
    expect(fake.table('seed_reply_queue')[0]!.status).toBe('pending');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('attempts>=3 iken LLM hatasi satiri failed yapar', async () => {
    const { svc, fake } = await setup({ llmThrows: new Error('timeout') });
    expect(await svc.processRow(row({ attempts: 3 }) as never)).toBe('failed');
    expect(fake.table('seed_reply_queue')[0]!.status).toBe('failed');
  });

  it('cikti denetimi gecilemezse de attempts<3 iken satir backoff ile korunur', async () => {
    const { svc, fake, sendMessage } = await setup({ llm: ['numaram 0532 111 22 33', 'instagramım @elif.taki'] });
    expect(await svc.processRow(row({ attempts: 1 }) as never)).toBe('deferred');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(fake.table('seed_reply_queue')[0]!.status).toBe('pending');
  });

  it('CHAT_LOCKED hata degildir: satiri oteler', async () => {
    const { svc, fake } = await setup({ sendThrows: hata('CHAT_LOCKED') });
    expect(await svc.processRow(row() as never)).toBe('deferred');
    expect(fake.table('seed_reply_queue')[0]!.status).toBe('pending');
  });

  it('NOT_MATCHED / MATCH_INACTIVE satiri iptal eder, hata saymaz', async () => {
    const { svc, fake } = await setup({ sendThrows: hata('MATCH_INACTIVE') });
    expect(await svc.processRow(row() as never)).toBe('cancelled');
    expect(fake.table('seed_reply_queue')[0]!.status).toBe('cancelled');
  });

  it('kriz mesajinda rolu birakir, SABIT metin gonderir, LLM cagirmaz', async () => {
    const { svc, sendMessage, generateSeedReply } = await setup({
      seed: { messages: [{ id: 'm1', match_id: MATCH, sender_id: INSAN, content: 'artık yaşamak istemiyorum', deleted_at: null, created_at: '2026-09-16T10:00:00Z' }] },
    });
    expect(await svc.processRow(row() as never)).toBe('sent');
    expect(generateSeedReply).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0]![2]).toContain('112');
  });

  it('18 yas alti beyaninda cevap vermeyi birakir', async () => {
    const { svc, sendMessage } = await setup({
      seed: { messages: [{ id: 'm1', match_id: MATCH, sender_id: INSAN, content: 'ben 16 yaşındayım bu arada', deleted_at: null, created_at: '2026-09-16T10:00:00Z' }] },
    });
    expect(await svc.processRow(row() as never)).toBe('cancelled');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('gonderimden sonra last_seen_at gunceller', async () => {
    const { svc, fake } = await setup();
    await svc.processRow(row() as never);
    expect(fake.table('users').find((u) => u.id === SEED)!.last_seen_at).toBeTruthy();
  });

  // GECMIS_LIMIT=20 yuzunden faz, kirpilmis gecmisten hesaplaniyordu: fazFor'a en fazla
  // 20 gidiyordu, yani ASLA 4 donmuyordu ve FAZ_METNI[4] (nazik kapanis) hicbir prompta
  // girmiyordu. Tarama ise gercek count kullaniyordu — faz iki farkli kaynaktan geliyordu.
  it('25+ mesajli eslesmede FAZ 4 baglamini kullanir (gecmis kirpmasi fazi bozmaz)', async () => {
    const mesajlar = Array.from({ length: 25 }, (_, i) => ({
      id: `m${i}`, match_id: MATCH, sender_id: i % 2 === 0 ? SEED : INSAN,
      content: 'selam', deleted_at: null,
      created_at: `2026-09-16T10:${String(i).padStart(2, '0')}:00Z`,
    }));
    const { svc, generateSeedReply } = await setup({ seed: { messages: mesajlar } });
    await svc.processRow(row() as never);

    expect(generateSeedReply.mock.calls[0]![0].system).toContain('Sohbeti nazikçe kapatıyorsun');
  });

  it('__QUESTION__ isaretlerini LLM gecmisine HAM gecirmez', async () => {
    const { svc, generateSeedReply } = await setup({
      seed: {
        messages: [
          { id: 'm0', match_id: MATCH, sender_id: SEED, content: '__QUESTION__:7f3a9c21-0000-4000-8000-000000000001', deleted_at: null, created_at: '2026-09-16T09:58:00Z' },
          { id: 'm1', match_id: MATCH, sender_id: INSAN, content: 'günün nasıl geçti', deleted_at: null, created_at: '2026-09-16T10:00:00Z' },
        ],
      },
    });
    await svc.processRow(row() as never);

    const turns = generateSeedReply.mock.calls[0]![0].turns;
    expect(turns.some((t) => t.text.includes('__QUESTION__'))).toBe(false);
    expect(turns.some((t) => t.text === '(soru kartı)')).toBe(true);
  });

  it('created_at ASLA elle yazilmaz', async () => {
    const { svc, sendMessage } = await setup();
    await svc.processRow(row() as never);
    expect(sendMessage.mock.calls[0]).toHaveLength(3); // (userId, matchId, content) — createdAt yok
  });
});
