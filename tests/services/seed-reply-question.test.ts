import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';

const SEED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSAN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MATCH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'q1', match_id: MATCH, seed_user_id: SEED, trigger_message_id: 'm1',
  question_id: null, kind: 'question', reply_due_at: '2026-09-16T10:01:00Z',
  status: 'claimed', attempts: 1, ...over,
});

const soru = (over: Record<string, unknown> = {}) => ({
  id: 'soru-1', match_id: MATCH, sender_id: INSAN, correct_option: 'C',
  answered_option: null, is_abandoned: false, has_unmatch_risk: false, has_chat_lock: false, ...over,
});

async function setup(opts: { seed?: Tables; llmJson?: string; createThrows?: Error } = {}) {
  const fake = createFakeSupabase({
    users: [
      { id: SEED, is_seed_profile: true, name: 'Elif', age: 31, city: 'Fethiye', bio: 'atölye', seed_persona: null },
      { id: INSAN, is_seed_profile: false },
    ],
    user_details: [{ user_id: SEED, job: 'Takı tasarımcısı', personality: 'Ambivert' }],
    matches: [{ id: MATCH, user1_id: SEED, user2_id: INSAN, is_active: true }],
    messages: [{ id: 'm1', match_id: MATCH, sender_id: INSAN, content: 'nbr', deleted_at: null, created_at: '2026-09-16T10:00:00Z' }],
    chat_questions: [],
    app_config: [{ id: 'cfg', seed_reply_enabled: true, seed_reply_fast_mode: false }],
    seed_reply_queue: [row()],
    ...opts.seed,
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));

  const varsayilan = JSON.stringify({
    question_text: 'Atölyede en çok neyle uğraşırım?', option_count: 4,
    option_a: 'Ahşap', option_b: 'Deri', option_c: 'Boncuk', option_d: 'Cam', correct_option: 'C',
  });
  const generateSeedReply = vi.fn(async () => ({ text: opts.llmJson ?? varsayilan, inputTokens: 80, outputTokens: 40 }));
  vi.doMock('../../src/services/seed-llm.service.js', () => ({
    generateSeedReply, SEED_LLM_MODEL: 'test-model',
    SeedLlmError: class extends Error { constructor(public code: string, m: string) { super(m); } },
  }));
  vi.doMock('../../src/services/chat.service.js', () => ({ chatService: { sendMessage: vi.fn(async () => ({ id: 'x' })) } }));

  const createQuestion = vi.fn<(matchId: string, senderId: string, data: unknown) => Promise<{ id: string }>>(
    async () => { if (opts.createThrows) throw opts.createThrows; return { id: 'yeni-soru' }; },
  );
  const answerQuestion = vi.fn<
    (questionId: string, userId: string, selectedOption: string | null) => Promise<{ is_correct: boolean; unmatched: boolean }>
  >(async () => ({ is_correct: true, unmatched: false }));
  vi.doMock('../../src/services/chat-question.service.js', () => ({
    chatQuestionService: { createQuestion, answerQuestion },
  }));

  const svc = await import('../../src/services/seed-reply.service.js');
  return { fake, svc, createQuestion, answerQuestion, generateSeedReply };
}

const hata = (code: string) => Object.assign(new Error(code), { code });

beforeEach(() => vi.resetModules());

describe('askQuestion', () => {
  it('soruyu KILITSIZ, unmatch risksiz ve guc bloksuz olusturur', async () => {
    const { svc, createQuestion } = await setup();
    expect(await svc.askQuestion(row() as never)).toBe('sent');
    const [matchId, senderId, payload] = createQuestion.mock.calls[0]!;
    expect(matchId).toBe(MATCH);
    expect(senderId).toBe(SEED);
    expect(payload).toMatchObject({ has_chat_lock: false, has_unmatch_risk: false, use_power_block: false });
  });

  it('LLM ciktisini createChatQuestionSchema ile dogrular; bozuksa gondermez', async () => {
    const { svc, createQuestion } = await setup({ llmJson: '{"question_text":"x"}' });
    expect(await svc.askQuestion(row() as never)).toBe('failed');
    expect(createQuestion).not.toHaveBeenCalled();
  });

  it('gunluk limit asilirsa iptal eder, hata saymaz', async () => {
    const { svc, fake } = await setup({ createThrows: hata('DAILY_LIMIT_EXCEEDED') });
    expect(await svc.askQuestion(row() as never)).toBe('cancelled');
    expect(fake.table('seed_reply_queue')[0]!.status).toBe('cancelled');
  });

  it('CHAT_LOCKED durumunda iptal eder (bot kilitliyken soru acamaz)', async () => {
    const { svc } = await setup({ createThrows: hata('CHAT_LOCKED') });
    expect(await svc.askQuestion(row() as never)).toBe('cancelled');
  });
});

describe('answerQuestionRow', () => {
  it('unmatch riskli soruyu HER ZAMAN dogru cevaplar', async () => {
    const { svc, answerQuestion } = await setup({
      seed: { chat_questions: [soru({ has_unmatch_risk: true, correct_option: 'D' })] },
    });
    await svc.answerQuestionRow(row({ kind: 'question_answer', question_id: 'soru-1' }) as never);
    expect(answerQuestion).toHaveBeenCalledWith('soru-1', SEED, 'D');
  });

  it('riskli olmayan soruda da gecerli bir sik gonderir ve ASLA null gondermez', async () => {
    const { svc, answerQuestion } = await setup({ seed: { chat_questions: [soru()] } });
    for (let i = 0; i < 25; i += 1) {
      answerQuestion.mockClear();
      await svc.answerQuestionRow(row({ kind: 'question_answer', question_id: 'soru-1' }) as never);
      const sik = answerQuestion.mock.calls[0]![2];
      expect(['A', 'B', 'C', 'D']).toContain(sik);
    }
  });

  it('kendi sordugu soruyu cevaplamaya kalkmaz', async () => {
    const { svc, answerQuestion } = await setup({ seed: { chat_questions: [soru({ sender_id: SEED })] } });
    expect(await svc.answerQuestionRow(row({ kind: 'question_answer', question_id: 'soru-1' }) as never)).toBe('cancelled');
    expect(answerQuestion).not.toHaveBeenCalled();
  });

  it('zaten cevaplanmis soruyu atlar', async () => {
    const { svc, answerQuestion } = await setup({ seed: { chat_questions: [soru({ answered_option: 'A' })] } });
    expect(await svc.answerQuestionRow(row({ kind: 'question_answer', question_id: 'soru-1' }) as never)).toBe('cancelled');
    expect(answerQuestion).not.toHaveBeenCalled();
  });
});

describe('scanAndEnqueue — soru cevabi', () => {
  it('bota sorulmus cevaplanmamis soru icin question_answer satiri acar', async () => {
    const { fake, svc } = await setup({ seed: { seed_reply_queue: [], chat_questions: [soru()] } });
    await svc.scanAndEnqueue();
    const satir = fake.table('seed_reply_queue').find((r) => r.kind === 'question_answer');
    expect(satir).toMatchObject({ match_id: MATCH, seed_user_id: SEED, question_id: 'soru-1' });
  });
});
