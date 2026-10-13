import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';

/**
 * Seed botu uc uca dil paketiyle calisir (2026-10-13): `users.locale = 'it'` olan seed'in kart,
 * guvenlik kapilari (kriz / 18 yas alti / kapanis), medya etiketleri, cikti denetimi, uyari
 * probe'u, soru uretimi ve admin onizlemesi Italyanca paketle; locale'siz seed TR (geri donus).
 */

const SEED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSAN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MATCH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ISTEK = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'q1', match_id: MATCH, seed_user_id: SEED, trigger_message_id: 'm1',
  question_id: null, media_request_id: null, kind: 'message', reply_due_at: '2026-10-13T10:01:00Z',
  status: 'claimed', attempts: 1, ...over,
});

const mesaj = (content: string, over: Record<string, unknown> = {}) => ({
  id: 'm1', match_id: MATCH, sender_id: INSAN, content, deleted_at: null, created_at: '2026-10-13T10:00:00Z', ...over,
});

interface Kurulum { locale?: string | null; mesajlar?: Record<string, unknown>[]; llm?: string[]; seed?: Tables }

async function setup(opts: Kurulum = {}) {
  const fake = createFakeSupabase({
    users: [
      {
        id: SEED, is_seed_profile: true, is_test_account: true, name: 'Giulia', age: 29, city: 'Milano', gender: 'WOMAN',
        bio: 'Grafica freelance, amo il mare.', seed_persona: null,
        ...(opts.locale !== undefined ? { locale: opts.locale } : {}),
      },
      { id: INSAN, is_seed_profile: false, name: 'Marco' },
    ],
    user_details: [{ user_id: SEED, job: 'Grafica', personality: 'Dışa dönük' }],
    matches: [{ id: MATCH, user1_id: SEED, user2_id: INSAN, is_active: true, media_enabled_by_user1: false, media_enabled_by_user2: true }],
    messages: opts.mesajlar ?? [mesaj('ciao, come va?')],
    media_requests: [{ id: ISTEK, match_id: MATCH, requester_id: INSAN, status: 'pending', created_at: '2026-10-13T10:00:30Z' }],
    chat_questions: [],
    app_config: [{ id: 'cfg', seed_reply_enabled: true, seed_reply_fast_mode: false }],
    seed_reply_queue: [row()],
    ...opts.seed,
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));

  const cevaplar = [...(opts.llm ?? ['tutto ok dai, tu?'])];
  const generateSeedReply = vi.fn(
    async (_i: { system: string; turns: Array<{ role: 'model' | 'user'; text: string }> }) =>
      ({ text: cevaplar.shift() ?? 'ok', inputTokens: 100, outputTokens: 10 }),
  );
  vi.doMock('../../src/services/seed-llm.service.js', () => ({
    generateSeedReply, SEED_LLM_MODEL: 'test-model',
    SeedLlmError: class extends Error { constructor(public code: string, m: string) { super(m); } },
  }));
  const sendMessage = vi.fn(async (_u: string, _m: string, _c: string) => ({ id: 'yeni' }));
  vi.doMock('../../src/services/chat.service.js', () => ({ chatService: { sendMessage } }));
  const createQuestion = vi.fn(async (_m: string, _s: string, _d: unknown) => ({ id: 'soru' }));
  vi.doMock('../../src/services/chat-question.service.js', () => ({
    chatQuestionService: { createQuestion, answerQuestion: vi.fn() },
  }));

  const svc = await import('../../src/services/seed-reply.service.js');
  const medya = await import('../../src/services/seed-reply-media.service.js');
  const onizleme = await import('../../src/services/seed-reply-preview.service.js');
  return { fake, svc, medya, onizleme, sendMessage, generateSeedReply, createQuestion };
}

beforeEach(() => vi.resetModules());

describe('processRow — Italyanca seed', () => {
  it('kart Italyanca ve dil zorlamasi iceriyor; cevap gonderilir', async () => {
    const { svc, generateSeedReply, sendMessage } = await setup({ locale: 'it' });
    expect(await svc.processRow(row() as never)).toBe('sent');
    const sistem = generateSeedReply.mock.calls[0]![0].system;
    expect(sistem).toContain('Ti chiami Giulia.');
    expect(sistem).toContain('Scrivi SEMPRE in italiano');
    expect(sistem).not.toContain('Adın');
    expect(sendMessage).toHaveBeenCalledWith(SEED, MATCH, 'tutto ok dai, tu?');
  });

  it('Italyanca kriz mesaji: LLM cagrilmaz, Italyanca sabit kriz cevabi (112 + Telefono Amico) gider', async () => {
    const { svc, generateSeedReply, sendMessage } = await setup({ locale: 'it', mesajlar: [mesaj('non ce la faccio più, voglio morire')] });
    expect(await svc.processRow(row() as never)).toBe('sent');
    expect(generateSeedReply).not.toHaveBeenCalled();
    const metin = sendMessage.mock.calls[0]![2];
    expect(metin).toContain('112');
    expect(metin).toContain('02 2327 2327');
  });

  it('Italyanca 18 yas alti beyani: satir iptal, hicbir sey gonderilmez', async () => {
    const { svc, fake, sendMessage, generateSeedReply } = await setup({ locale: 'it', mesajlar: [mesaj('ho 16 anni, tu?')] });
    expect(await svc.processRow(row() as never)).toBe('cancelled');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(generateSeedReply).not.toHaveBeenCalled();
    expect(fake.table('seed_reply_queue')[0]!.last_error).toBe('18 yas alti beyani');
  });

  it('Italyanca kapanis: kart kapanis baglamini (NON FARE DOMANDE) tasir', async () => {
    const { svc, generateSeedReply } = await setup({ locale: 'it', mesajlar: [mesaj('buonanotte, a domani')] });
    await svc.processRow(row() as never);
    expect(generateSeedReply.mock.calls[0]![0].system).toContain('NON FARE DOMANDE');
  });

  it('Italyanca telefon ciktisi elenir, ikinci deneme Italyanca uyari probe ile', async () => {
    const { svc, generateSeedReply, sendMessage } = await setup({
      locale: 'it', llm: ['scrivimi al 333 123 4567', 'magari piu avanti, vediamo'],
    });
    expect(await svc.processRow(row() as never)).toBe('sent');
    expect(generateSeedReply).toHaveBeenCalledTimes(2);
    expect(generateSeedReply.mock.calls[1]![0].system).toContain('# ATTENZIONE');
    expect(sendMessage).toHaveBeenCalledWith(SEED, MATCH, 'magari piu avanti, vediamo');
  });

  it('foto ve soru karti gecmise Italyanca etiketle girer', async () => {
    const { svc, generateSeedReply } = await setup({
      locale: 'it',
      mesajlar: [
        mesaj('https://x.supabase.co/storage/v1/a.jpg', { id: 'm0', is_image: true, created_at: '2026-10-13T09:59:00Z' }),
        mesaj('__QUESTION__:abc'),
      ],
    });
    await svc.processRow(row() as never);
    const turns = generateSeedReply.mock.calls[0]![0].turns.map((t) => t.text);
    expect(turns).toEqual(['(ha mandato una foto)', '(domanda a quiz)']);
  });

  it('locale alani olmayan seed TR paketiyle calisir (geri donus): Turkce kart, Italyanca kriz tetiklemez', async () => {
    const { svc, generateSeedReply } = await setup({ mesajlar: [mesaj('voglio morire')] });
    expect(await svc.processRow(row() as never)).toBe('sent');
    expect(generateSeedReply.mock.calls[0]![0].system).toContain('Adın Giulia. 29 yaşında');
  });
});

describe('askQuestion — Italyanca seed', () => {
  it('soru talimati Italyanca, tetik "prepara la domanda"', async () => {
    const json = JSON.stringify({
      question_text: 'Qual è il mio posto preferito?', option_count: 4,
      option_a: 'Montagna', option_b: 'Mare', option_c: 'Città', option_d: 'Lago', correct_option: 'B',
    });
    const { svc, generateSeedReply, createQuestion } = await setup({ locale: 'it', llm: [json] });
    expect(await svc.askQuestion(row({ kind: 'question' }) as never)).toBe('sent');
    const istek = generateSeedReply.mock.calls[0]![0];
    expect(istek.system).toContain('Sei Giulia. Il tuo lavoro: Grafica.');
    expect(istek.system).toContain('Scrivi la domanda e le opzioni in italiano.');
    expect(istek.turns).toEqual([{ role: 'user', text: 'prepara la domanda' }]);
    expect(createQuestion).toHaveBeenCalledTimes(1);
  });
});

describe('respondMediaRequest — Italyanca seed', () => {
  const medyaRow = () => row({ kind: 'media_request', media_request_id: ISTEK, trigger_message_id: null });

  it('istek Italyanca etiketle gecmise girer, gecistirme Italyanca denetimden gecer', async () => {
    const { medya, generateSeedReply, sendMessage } = await setup({ locale: 'it', llm: ['per ora no, dai'] });
    expect(await medya.respondMediaRequest(medyaRow() as never)).toBe('sent');
    const turns = generateSeedReply.mock.calls[0]![0].turns;
    expect(turns.at(-1)).toEqual({ role: 'user', text: '(ha chiesto di attivare la condivisione di foto e vocali)' });
    expect(sendMessage).toHaveBeenCalledWith(SEED, MATCH, 'per ora no, dai');
  });

  it('Italyanca 18 yas alti beyaninda ret yapilir ama gecistirme YAZILMAZ', async () => {
    const { medya, fake, generateSeedReply, sendMessage } = await setup({ locale: 'it', mesajlar: [mesaj('sono minorenne')] });
    expect(await medya.respondMediaRequest(medyaRow() as never)).toBe('sent');
    expect(fake.table('media_requests')[0]!.status).toBe('rejected');
    expect(generateSeedReply).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('previewSeedReply — Italyanca seed', () => {
  it('admin onizlemesi Italyanca karti ve Italyanca denetimi kullanir, dili raporlar', async () => {
    const { onizleme } = await setup({ locale: 'it', llm: ['chiamami 333 123 4567'] });
    const r = await onizleme.previewSeedReply({ seedUserId: SEED, turns: [{ kim: 'insan', text: 'ciao' }] });
    expect(r.profil.locale).toBe('it');
    expect(r.kart).toContain('Ti chiami Giulia.');
    expect(r.elendi).toBe('iletisim');
  });
});
