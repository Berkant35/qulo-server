import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';

/** Fixture: oran 0,25; HALF 10 mor → 2 ödül; SKIP 8 mor → 2 ödül. Ödül soruyu gönderene gider. */
const ANSWERER = '11111111-1111-4111-8111-111111111111';
const SENDER = '22222222-2222-4222-8222-222222222222';
const MATCH = '33333333-3333-4333-8333-333333333333';
const QUESTION = '44444444-4444-4444-8444-444444444444';

const user = (id: string, over: Record<string, unknown> = {}) => ({
  id, purple_diamonds: 50, purple_paid: 0, green_diamonds: 0, rainbow_diamonds: 0, ...over,
});
const power = (name: string) => ({ id: `p-${name}`, name, is_active: true, accuracy_rate: 0.7, special_green_reward: 0 });
const question = (over: Record<string, unknown> = {}) => ({
  id: QUESTION, match_id: MATCH, sender_id: SENDER,
  question_text: 'En sevdigim sehir?', option_count: 4,
  option_a: 'Izmir', option_b: 'Ankara', option_c: 'Bursa', option_d: 'Van',
  correct_option: 'A', hint_text: null, time_limit_seconds: 30,
  answered_option: null, is_correct: null, is_abandoned: false,
  has_power_block: false, power_block_removed: false, powers_used: [],
  eliminated_options: null, oracle_suggested_option: null, ...over,
});

async function setup(seed: Tables = {}, options: FakeSupabaseOptions = {}) {
  const fake = createFakeSupabase(
    {
      economy_config_versions: [activeConfigRow()],
      users: [user(ANSWERER), user(SENDER)],
      matches: [{ id: MATCH, user1_id: SENDER, user2_id: ANSWERER, is_active: true }],
      powers: [power('ORACLE'), power('HALF'), power('SKIP')],
      chat_questions: [question()],
      ...seed,
    },
    { rpc: { chat_question_mark_power: { data: true } }, ...options },
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { chatQuestionService } = await import('../../src/services/chat-question.service.js');
  return { fake, chatQuestionService };
}

const row = (fake: ReturnType<typeof createFakeSupabase>, id: string) => fake.table('users').find((u) => u.id === id)!;

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(Math, 'random').mockReturnValue(0.1);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatQuestionService — ödül bölme', () => {
  it('HALF ödenmiş morla: gönderene rainbow, yanıtta rainbow_reward', async () => {
    const { fake, chatQuestionService } = await setup({ users: [user(ANSWERER, { purple_paid: 50 }), user(SENDER)] });
    const result = await chatQuestionService.usePower(QUESTION, ANSWERER, 'HALF');
    expect(row(fake, SENDER)).toMatchObject({ green_diamonds: 0, rainbow_diamonds: 2 });
    expect(result).toMatchObject({ green_reward: 0, rainbow_reward: 2 });
  });

  it('HALF bedava morla: bugünkü gibi yeşil, rainbow_reward 0', async () => {
    const { fake, chatQuestionService } = await setup();
    const result = await chatQuestionService.usePower(QUESTION, ANSWERER, 'HALF');
    expect(row(fake, SENDER)).toMatchObject({ green_diamonds: 2, rainbow_diamonds: 0 });
    expect(result).toMatchObject({ green_reward: 2, rainbow_reward: 0 });
  });

  it('envanterden kullanılan güç rainbow üretmez (mor harcanmadı)', async () => {
    const { fake, chatQuestionService } = await setup({
      users: [user(ANSWERER, { purple_paid: 50 }), user(SENDER)],
      user_power_inventory: [{ id: 'inv-1', user_id: ANSWERER, power_name: 'HALF', count: 1 }],
    });
    await chatQuestionService.usePower(QUESTION, ANSWERER, 'HALF');
    expect(row(fake, SENDER).rainbow_diamonds).toBe(0);
    expect(row(fake, ANSWERER)).toMatchObject({ purple_diamonds: 50, purple_paid: 50 });
  });
});

describe('ChatQuestionService — SKIP ve kurtarma bölme (SKIP 8 mor → toplam 2)', () => {
  it('SKIP ödenmiş morla: gönderene rainbow, yanıtta rainbow_reward', async () => {
    const { fake, chatQuestionService } = await setup({ users: [user(ANSWERER, { purple_paid: 50 }), user(SENDER)] });
    const result = await chatQuestionService.answerQuestion(QUESTION, ANSWERER, 'A', 'SKIP');
    expect(row(fake, SENDER)).toMatchObject({ green_diamonds: 0, rainbow_diamonds: 2 });
    expect(result).toMatchObject({ skipped: true, green_reward: 0, rainbow_reward: 2 });
  });

  it('kurtarma ödenmiş morla: gönderene rainbow', async () => {
    const { fake, chatQuestionService } = await setup({
      users: [user(ANSWERER, { purple_paid: 50 }), user(SENDER)],
      chat_questions: [question({ answered_option: 'B', is_correct: false })],
    });
    const result = await chatQuestionService.rescueQuestion(QUESTION, ANSWERER);
    expect(row(fake, SENDER)).toMatchObject({ green_diamonds: 0, rainbow_diamonds: 2 });
    expect(result).toMatchObject({ rescued: true, green_reward: 0, rainbow_reward: 2 });
  });

  it('ödül yazımı patlarsa harcama kalır, yanıt hesaplanan payı döner (mevcut davranış)', async () => {
    const { fake, chatQuestionService } = await setup(
      { users: [user(ANSWERER, { purple_paid: 50 }), user(SENDER)] },
      // 1. insert = çözenin PURPLE harcama satırı; 2. insert = gönderenin RAINBOW satırı → patlar.
      { failOn: [{ table: 'diamond_transactions', op: 'insert', failAfter: 1 }] },
    );
    const result = await chatQuestionService.answerQuestion(QUESTION, ANSWERER, 'A', 'SKIP');
    expect(row(fake, ANSWERER).purple_diamonds).toBe(42);
    expect(result).toMatchObject({ rainbow_reward: 2 });
  });
});
