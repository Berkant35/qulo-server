import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';

/**
 * Fixture: oran 0,25; HALF 10 mor → toplam floor(2,5)=2 ödül; '3' çarpanı yok → 1.0.
 * Ödenmiş mor harcanınca payı hedefte RAINBOW olur; toplam değişmez.
 */
const SOLVER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const Q1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const Q2 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
const Q3 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3';

const user = (id: string, over: Record<string, unknown> = {}) => ({
  id, purple_diamonds: 50, purple_paid: 0, green_diamonds: 0, rainbow_diamonds: 0, ...over,
});
const power = (name: string) => ({ id: `p-${name}`, name, is_active: true, base_cost: 10, accuracy_rate: 0.7 });
const question = (id: string, over: Record<string, unknown> = {}) => ({
  id, user_id: TARGET, order_num: 1, question_text: 'En sevdigim renk?',
  correct_answer: 2, answer_1: 'Kirmizi', answer_2: 'Mavi', answer_3: 'Yesil', answer_4: 'Sari',
  hint_text: null, time_limit: 30, locale: 'tr',
  stats_correct: 0, stats_wrong: 0, stats_solve_count: 0, stats_total_time_spent: 0,
  stats_copy_used: 0, stats_half_used: 0, stats_hint_used: 0, stats_time_extend_used: 0,
  stats_skip_used: 0, stats_answer_1_count: 0, stats_answer_2_count: 0,
  stats_answer_3_count: 0, stats_answer_4_count: 0, stats_green_earned: 0, ...over,
});
const session = (over: Record<string, unknown> = {}) => ({
  id: SESSION, solver_id: SOLVER, target_id: TARGET, status: 'IN_PROGRESS',
  current_q: 1, total_questions: 3,
  expires_at: new Date(Date.now() + 3_600_000).toISOString(), completed_at: null,
  question_ids: [Q1, Q2, Q3], current_q_powers: [], current_q_eliminated: [],
  current_q_oracle: null, ...over,
});

async function setup(seed: Tables = {}, options: FakeSupabaseOptions = {}) {
  const fake = createFakeSupabase(
    {
      economy_config_versions: [activeConfigRow()],
      users: [user(SOLVER), user(TARGET)],
      powers: [power('ORACLE'), power('HALF')],
      questions: [question(Q1), question(Q2, { order_num: 2 }), question(Q3, { order_num: 3 })],
      quiz_sessions: [session()],
      quiz_answers: [],
      ...seed,
    },
    { rpc: { quiz_session_mark_power: { data: true } }, ...options },
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { quizService } = await import('../../src/services/quiz.service.js');
  return { fake, quizService };
}

const row = (fake: ReturnType<typeof createFakeSupabase>, id: string) => fake.table('users').find((u) => u.id === id)!;

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(Math, 'random').mockReturnValue(0.1);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('QuizService — güç ödülü bölme', () => {
  it('bedava morla: bugünkü gibi hepsi yeşil, RAINBOW satırı yok', async () => {
    const { fake, quizService } = await setup();
    await quizService.answerQuestion(SESSION, SOLVER, undefined, 'HALF');
    expect(row(fake, TARGET)).toMatchObject({ green_diamonds: 2, rainbow_diamonds: 0 });
    expect(fake.table('diamond_transactions').some((t) => t.type === 'RAINBOW')).toBe(false);
  });

  it('tamamı ödenmiş morla: ödül rainbow olur, çözenin sayacı düşer', async () => {
    const { fake, quizService } = await setup({ users: [user(SOLVER, { purple_paid: 50 }), user(TARGET)] });
    await quizService.answerQuestion(SESSION, SOLVER, undefined, 'HALF');
    expect(row(fake, TARGET)).toMatchObject({ green_diamonds: 0, rainbow_diamonds: 2 });
    expect(row(fake, SOLVER)).toMatchObject({ purple_diamonds: 40, purple_paid: 40 });
    expect(fake.table('diamond_transactions')).toContainEqual(
      expect.objectContaining({ user_id: TARGET, type: 'RAINBOW', amount: 2, reason: 'POWER_REWARD:HALF' }),
    );
  });

  it('kısmen ödenmiş: 4 ödenmiş → floor(1,0)=1 rainbow + 1 yeşil', async () => {
    const { fake, quizService } = await setup({ users: [user(SOLVER, { purple_paid: 4 }), user(TARGET)] });
    await quizService.answerQuestion(SESSION, SOLVER, undefined, 'HALF');
    expect(row(fake, TARGET)).toMatchObject({ green_diamonds: 1, rainbow_diamonds: 1 });
  });

  it('soru istatistiğine yalnız yeşil pay yazılır', async () => {
    const { fake, quizService } = await setup({ users: [user(SOLVER, { purple_paid: 4 }), user(TARGET)] });
    await quizService.answerQuestion(SESSION, SOLVER, undefined, 'HALF');
    expect(fake.table('questions').find((q) => q.id === Q1)!.stats_green_earned).toBe(1);
  });
});

describe('QuizService.rescueWithSkip — ödül bölme', () => {
  // Ücretli kurtarma sınanıyor: ilk quiz ikinci şansı (2026-10-04) bu oturumda SKIP'i bedava yapardı.
  const paidRescueConfig = [activeConfigRow({ quizOnboarding: { freeSecondChances: 0, freeSecondChanceSessionWindow: 3 } })];

  it('ödenmiş morla kurtarma: ödül hedefte rainbow', async () => {
    const { fake, quizService } = await setup({
      economy_config_versions: paidRescueConfig,
      users: [user(SOLVER, { purple_paid: 50 }), user(TARGET)],
      powers: [power('ORACLE'), power('HALF'), power('SKIP')],
      quiz_answers: [{ id: 'a1', session_id: SESSION, question_id: Q1, is_correct: false, power_used: null }],
    });
    await quizService.rescueWithSkip(SESSION, SOLVER, 'SKIP');
    expect(row(fake, TARGET)).toMatchObject({ green_diamonds: 0, rainbow_diamonds: 2 });
    expect(fake.table('diamond_transactions')).toContainEqual(
      expect.objectContaining({ user_id: TARGET, type: 'RAINBOW', amount: 2, reason: 'POWER_REWARD:SKIP_RESCUE' }),
    );
  });

  it('bedava morla kurtarma: bugünkü gibi yeşil', async () => {
    const { fake, quizService } = await setup({
      economy_config_versions: paidRescueConfig,
      powers: [power('ORACLE'), power('HALF'), power('SKIP')],
      quiz_answers: [{ id: 'a1', session_id: SESSION, question_id: Q1, is_correct: false, power_used: null }],
    });
    await quizService.rescueWithSkip(SESSION, SOLVER, 'SKIP');
    expect(row(fake, TARGET)).toMatchObject({ green_diamonds: 2, rainbow_diamonds: 0 });
  });
});
