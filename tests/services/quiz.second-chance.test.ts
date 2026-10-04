import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions, type Row } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';

/**
 * İlk quiz ikinci şansı (2026-10-04, ilk gün tutma planı #4): kullanıcının ilk K (fixture 3) quiz
 * oturumunda, ilk yanlıştan sonraki SKIP kurtarması bedava; kullanıcı başına toplam 1, oturum başına 1.
 * Bedava = envanter/elmas düşmez, hedefe ödül yok, kurtarılan cevap `power_used = FREE_SECOND_CHANCE`.
 *
 * Ücretli dalda tutar `calculatePowerCost`'un işi; burada yalnız "bakiye düştü/düşmedi" sınanır.
 */

const SOLVER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OLD_1 = 'cccccccc-cccc-4ccc-8ccc-000000000001';
const OLD_2 = 'cccccccc-cccc-4ccc-8ccc-000000000002';
const OLD_3 = 'cccccccc-cccc-4ccc-8ccc-000000000003';
const Q1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const Q2 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
const Q3 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3';

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
  started_at: '2026-10-04T12:00:00.000Z', current_q: 1, total_questions: 3,
  expires_at: new Date(Date.now() + 3_600_000).toISOString(), completed_at: null,
  question_ids: [Q1, Q2, Q3], current_q_powers: [], current_q_eliminated: [],
  current_q_oracle: null, ...over,
});

/** Aynı çözücünün daha eski, bitmiş oturumu. */
const oldSession = (id: string, startedAt: string) => session({
  id, status: 'FAILED', started_at: startedAt, completed_at: startedAt,
});

const markPower = (args: { p_session_id: string; p_power: string }, table: (n: string) => Row[]) => {
  const row = table('quiz_sessions').find((r) => r.id === args.p_session_id);
  if (!row) return { data: false };
  const powers: string[] = row.current_q_powers ?? [];
  if (powers.includes(args.p_power)) return { data: false };
  row.current_q_powers = [...powers, args.p_power];
  return { data: true };
};

async function setup(seed: Tables = {}, options: FakeSupabaseOptions = {}) {
  const fake = createFakeSupabase(
    {
      economy_config_versions: [activeConfigRow()],
      users: [
        { id: SOLVER, purple_diamonds: 50, purple_paid: 0, green_diamonds: 0 },
        { id: TARGET, purple_diamonds: 0, purple_paid: 0, green_diamonds: 0, rainbow_diamonds: 0 },
      ],
      powers: [
        { id: 'p-SKIP', name: 'SKIP', is_active: true, base_cost: 8 },
        { id: 'p-SKIP_ALL', name: 'SKIP_ALL', is_active: true, base_cost: 20 },
      ],
      questions: [question(Q1), question(Q2, { order_num: 2 }), question(Q3, { order_num: 3 })],
      quiz_sessions: [session()],
      quiz_answers: [],
      user_power_inventory: [],
      diamond_transactions: [],
      ...seed,
    },
    { rpc: { quiz_session_mark_power: markPower }, ...options },
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { quizService } = await import('../../src/services/quiz.service.js');
  return { fake, quizService };
}

type Fake = Awaited<ReturnType<typeof setup>>['fake'];
const solver = (fake: Fake) => fake.table('users').find((u) => u.id === SOLVER)!;
const target = (fake: Fake) => fake.table('users').find((u) => u.id === TARGET)!;
const answerOf = (fake: Fake, questionId: string) =>
  fake.table('quiz_answers').find((a) => a.question_id === questionId)!;
const flag = (reply: unknown, key: string) => (reply as Record<string, unknown>)[key];

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('yanlış cevap — free_second_chance bayrağı', () => {
  it('ilk quiz oturumunda ilk yanlışta true', async () => {
    const { quizService } = await setup();

    const reply = await quizService.answerQuestion(SESSION, SOLVER, 1);

    expect(flag(reply, 'can_rescue')).toBe(true);
    expect(flag(reply, 'free_second_chance')).toBe(true);
  });

  it('oturum ilk K oturumun dışındaysa false (yalnız yeni kullanıcı)', async () => {
    const { quizService } = await setup({
      quiz_sessions: [
        oldSession(OLD_1, '2026-10-01T10:00:00.000Z'),
        oldSession(OLD_2, '2026-10-02T10:00:00.000Z'),
        oldSession(OLD_3, '2026-10-03T10:00:00.000Z'),
        session(),
      ],
    });

    const reply = await quizService.answerQuestion(SESSION, SOLVER, 1);

    expect(flag(reply, 'free_second_chance')).toBe(false);
  });

  it('hak daha önceki bir oturumda kullanıldıysa false (kullanıcı başına 1)', async () => {
    const { quizService } = await setup({
      quiz_sessions: [oldSession(OLD_1, '2026-10-03T10:00:00.000Z'), session()],
      quiz_answers: [{
        id: 'a-old', session_id: OLD_1, question_id: Q1, selected_answer: 1,
        is_correct: true, power_used: 'FREE_SECOND_CHANCE',
      }],
    });

    const reply = await quizService.answerQuestion(SESSION, SOLVER, 1);

    expect(flag(reply, 'free_second_chance')).toBe(false);
  });

  it('config\'te 0 ise kapalı', async () => {
    const { quizService } = await setup({
      economy_config_versions: [activeConfigRow({
        quizOnboarding: { freeSecondChances: 0, freeSecondChanceSessionWindow: 3 },
      })],
    });

    const reply = await quizService.answerQuestion(SESSION, SOLVER, 1);

    expect(flag(reply, 'free_second_chance')).toBe(false);
  });

  it('uygunluk sorgusu patlarsa false (fail-closed) ve cevap akışı bozulmaz', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // quiz_sessions select: 1. getActiveSession, 2. uygunluk penceresi → yalnız 2.'si patlar.
    const { quizService } = await setup({}, {
      failOn: [{ table: 'quiz_sessions', op: 'select', failAfter: 1 }],
    });

    const reply = await quizService.answerQuestion(SESSION, SOLVER, 1);

    expect(flag(reply, 'can_rescue')).toBe(true);
    expect(flag(reply, 'free_second_chance')).toBe(false);
  });
});

describe('rescueWithSkip — ücretsiz ikinci şans', () => {
  it('SKIP bedava: mor/envanter düşmez, hedefe ödül yok, cevap işaretlenir, soru ilerler', async () => {
    const { fake, quizService } = await setup({
      user_power_inventory: [{ id: 'i1', user_id: SOLVER, power_name: 'SKIP', count: 1 }],
    });
    await quizService.answerQuestion(SESSION, SOLVER, 1);

    const reply = await quizService.rescueWithSkip(SESSION, SOLVER, 'SKIP');

    expect(flag(reply, 'free_second_chance_used')).toBe(true);
    expect(flag(reply, 'next_question')).toBe(2);
    expect(solver(fake).purple_diamonds).toBe(50);
    // Başlangıç paketindeki SKIP korunur — ikinci şans onu yemez.
    expect(fake.table('user_power_inventory')[0].count).toBe(1);
    expect(target(fake).green_diamonds).toBe(0);
    expect(fake.table('diamond_transactions')).toHaveLength(0);
    expect(answerOf(fake, Q1)).toMatchObject({ is_correct: true, power_used: 'FREE_SECOND_CHANCE' });
    expect(fake.table('quiz_sessions')[0].current_q).toBe(2);
  });

  it('aynı oturumda ikinci yanlış ücretli: bayrak false, SKIP mor düşer', async () => {
    const { fake, quizService } = await setup();
    await quizService.answerQuestion(SESSION, SOLVER, 1);
    await quizService.rescueWithSkip(SESSION, SOLVER, 'SKIP');

    const second = await quizService.answerQuestion(SESSION, SOLVER, 1);
    expect(flag(second, 'free_second_chance')).toBe(false);

    const reply = await quizService.rescueWithSkip(SESSION, SOLVER, 'SKIP');
    expect(flag(reply, 'free_second_chance_used')).toBe(false);
    expect(solver(fake).purple_diamonds).toBeLessThan(50);
    expect(answerOf(fake, Q2)).toMatchObject({ is_correct: true, power_used: 'SKIP' });
  });

  it('SKIP_ALL ücretsiz şansa girmez', async () => {
    const { fake, quizService } = await setup();
    await quizService.answerQuestion(SESSION, SOLVER, 1);

    const reply = await quizService.rescueWithSkip(SESSION, SOLVER, 'SKIP_ALL');

    expect(flag(reply, 'free_second_chance_used')).toBe(false);
    expect(solver(fake).purple_diamonds).toBeLessThan(50);
  });

  it('eş zamanlı iki kurtarma: yalnız biri geçer, hak bir kez kullanılır', async () => {
    const { fake, quizService } = await setup();
    await quizService.answerQuestion(SESSION, SOLVER, 1);

    const results = await Promise.allSettled([
      quizService.rescueWithSkip(SESSION, SOLVER, 'SKIP'),
      quizService.rescueWithSkip(SESSION, SOLVER, 'SKIP'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    });
    expect(solver(fake).purple_diamonds).toBe(50);
    expect(fake.table('quiz_sessions')[0].current_q).toBe(2);
  });
});

describe('rescueWithSkip — ücretli kurtarmada talep-önce-ücret', () => {
  const noChance = () => activeConfigRow({ quizOnboarding: { freeSecondChances: 0, freeSecondChanceSessionWindow: 3 } });

  it('eş zamanlı iki ücretli kurtarma yalnız BİR kez ücret alır', async () => {
    const { fake, quizService } = await setup({ economy_config_versions: [noChance()] });
    await quizService.answerQuestion(SESSION, SOLVER, 1);

    await Promise.allSettled([
      quizService.rescueWithSkip(SESSION, SOLVER, 'SKIP'),
      quizService.rescueWithSkip(SESSION, SOLVER, 'SKIP'),
    ]);

    const spends = fake.table('diamond_transactions').filter((t) => t.user_id === SOLVER && t.amount < 0);
    expect(spends).toHaveLength(1);
  });

  it('mor düştükten sonra hedef ödülü yazılamazsa kurtarma yine tamamlanır (server-review M4)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fake, quizService } = await setup({ economy_config_versions: [noChance()] }, {
      // 1. diamond_transactions insert = çözücünün harcaması; 2. = hedefin ödülü → patlar.
      failOn: [{ table: 'diamond_transactions', op: 'insert', failAfter: 1 }],
    });
    await quizService.answerQuestion(SESSION, SOLVER, 1);

    const reply = await quizService.rescueWithSkip(SESSION, SOLVER, 'SKIP');

    expect(flag(reply, 'next_question')).toBe(2);
    expect(answerOf(fake, Q1)).toMatchObject({ is_correct: true, power_used: 'SKIP' });
    expect(solver(fake).purple_diamonds).toBeLessThan(50);
  });

  it('yetersiz elmasta talep geri verilir (tekrar denenebilir) ve hata istemciye gider', async () => {
    const { fake, quizService } = await setup({
      economy_config_versions: [noChance()],
      users: [
        { id: SOLVER, purple_diamonds: 0, purple_paid: 0, green_diamonds: 0 },
        { id: TARGET, purple_diamonds: 0, purple_paid: 0, green_diamonds: 0 },
      ],
    });
    await quizService.answerQuestion(SESSION, SOLVER, 1);

    await expect(quizService.rescueWithSkip(SESSION, SOLVER, 'SKIP'))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_DIAMONDS' });
    expect(answerOf(fake, Q1)).toMatchObject({ is_correct: false, power_used: null });

    // Satın aldı, tekrar dener → geçer.
    solver(fake).purple_diamonds = 50;
    const reply = await quizService.rescueWithSkip(SESSION, SOLVER, 'SKIP');
    expect(flag(reply, 'next_question')).toBe(2);
  });
});
