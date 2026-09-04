import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';

/**
 * Quiz guc akisi — bu servisin ilk testleri.
 *
 * Chat ile ayni bug: ORACLE ile HALF birbirinden habersizdi. HALF sonucu
 * `quiz_sessions.current_q_eliminated`'a, ORACLE onerisi `current_q_oracle`'a yazilir
 * (yasam dongusu `current_q_powers` ile ayni: soru gecisinde sifirlanir).
 *
 * `Math.random` sabitlenir: ORACLE'da 0.99 → yanlis dal (accuracy 0.7), 0.1 → dogru dal.
 * HALF'ta `shuffleArray` (Fisher-Yates) 0.1 ile deterministik: [x,y,z] → [y,z,x].
 */

const SOLVER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const Q1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const Q2 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
const Q3 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3';

const user = (id: string) => ({ id, purple_diamonds: 50, green_diamonds: 0 });

const power = (name: string) => ({
  id: `p-${name}`, name, is_active: true, base_cost: 10, accuracy_rate: 0.7,
});

/** Dogru cevabi 2 olan soru; istatistik sayaclari sifir. */
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

type Fake = ReturnType<typeof createFakeSupabase>;

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

const sessionRow = (fake: Fake) => fake.table('quiz_sessions')[0];
const userRow = (fake: Fake, id: string) => fake.table('users').find((u) => u.id === id)!;
/** answerQuestion donus tipi bir birlesim; guc yolunda `power_result` var. */
const powerResult = (reply: unknown): Record<string, any> =>
  (reply as { power_result?: Record<string, any> }).power_result ?? {};
const sorted = (xs: readonly number[] | null | undefined) => [...(xs ?? [])].sort();

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('QuizService.answerQuestion — HALF', () => {
  it('elenen iki yanlis indeksi oturuma yazar', async () => {
    const { fake, quizService } = await setup();

    const reply = await quizService.answerQuestion(SESSION, SOLVER, undefined, 'HALF');

    const removed = powerResult(reply).removed_indices as number[];
    expect(removed).toHaveLength(2);
    expect(removed).not.toContain(2);
    expect(sessionRow(fake).current_q_eliminated).toEqual(removed);
  });

  it('ORACLE daha once onerdiyse o indeksi elemez — ters sira sizintisi kapali', async () => {
    const { fake, quizService } = await setup({
      quiz_sessions: [session({ current_q_oracle: 4, current_q_powers: ['ORACLE'] })],
    });

    const reply = await quizService.answerQuestion(SESSION, SOLVER, undefined, 'HALF');

    // Havuz {1, 3}: ikisi de elenir, 4 hayatta kalir.
    expect(sorted(powerResult(reply).removed_indices)).toEqual([1, 3]);
    expect(sorted(sessionRow(fake).current_q_eliminated)).toEqual([1, 3]);
  });

  it('ayni guc ikinci kez basilirsa ucret alinmaz, sonuc yazilmaz', async () => {
    const { fake, quizService } = await setup({}, {
      rpc: { quiz_session_mark_power: { data: false } }, // RPC "zaten isaretli" der
    });

    await expect(quizService.answerQuestion(SESSION, SOLVER, undefined, 'HALF'))
      .rejects.toMatchObject({ code: 'POWER_ALREADY_USED' });

    expect(userRow(fake, SOLVER).purple_diamonds).toBe(50);
    expect(userRow(fake, TARGET).green_diamonds).toBe(0);
    expect(sessionRow(fake).current_q_eliminated).toEqual([]);
  });

  it('sonuc yazilamazsa istek yine basarili doner — kullanici zaten odedi', async () => {
    // HALF yolunda quiz_sessions'a ilk ve tek update HALF persist'i (isaretleme RPC ile).
    const { fake, quizService } = await setup({}, {
      failOn: [{ table: 'quiz_sessions', op: 'update', error: { message: 'boom' } }],
    });

    const reply = await quizService.answerQuestion(SESSION, SOLVER, undefined, 'HALF');

    expect(powerResult(reply).removed_indices).toHaveLength(2);
    expect(userRow(fake, SOLVER).purple_diamonds).toBe(40);
    expect(sessionRow(fake).current_q_eliminated).toEqual([]);
  });
});

describe('QuizService.answerQuestion — ORACLE', () => {
  it('HALF sonrasi yanlis dalinda bile elenmis indeksi onermez', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { quizService } = await setup({
      quiz_sessions: [session({ current_q_eliminated: [3, 4], current_q_powers: ['HALF'] })],
    });

    const reply = await quizService.answerQuestion(SESSION, SOLVER, undefined, 'ORACLE');

    // Havuz {1, 2}; yanlis dali kalan tek yanlisi (1) onermeli.
    expect(powerResult(reply).suggested_answer_index).toBe(1);
  });

  it('HALF sonrasi dogru dalinda dogru indeksi onerir', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const { quizService } = await setup({
      quiz_sessions: [session({ current_q_eliminated: [3, 4], current_q_powers: ['HALF'] })],
    });

    const reply = await quizService.answerQuestion(SESSION, SOLVER, undefined, 'ORACLE');

    expect(powerResult(reply).suggested_answer_index).toBe(2);
  });

  it('HALF kullanilmadiysa tum yanlis indekslerden secer', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { quizService } = await setup();

    const reply = await quizService.answerQuestion(SESSION, SOLVER, undefined, 'ORACLE');

    expect([1, 3, 4]).toContain(powerResult(reply).suggested_answer_index);
  });

  it('onerisini oturuma yazar — sonraki HALF icin', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { fake, quizService } = await setup();

    const reply = await quizService.answerQuestion(SESSION, SOLVER, undefined, 'ORACLE');

    expect(sessionRow(fake).current_q_oracle).toBe(powerResult(reply).suggested_answer_index);
  });

  it('ucundan uca HALF→ORACLE: elenmis indeksi onermez, ucret ve odul birikir', async () => {
    const { fake, quizService } = await setup();

    // HALF fazi (0.1): Fisher-Yates [1,3,4] → [3,4,1] → elenen {3,4}, kalan tek yanlis 1.
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const half = await quizService.answerQuestion(SESSION, SOLVER, undefined, 'HALF');
    expect(sorted(powerResult(half).removed_indices)).toEqual([3, 4]);

    // ORACLE fazi (0.99): yanlis dal. Duzeltme oncesi havuz [1,3,4], floor(0.99×3)=2 → 4
    // (ELENMIS). Duzeltme sonrasi havuz [1] → 1. Bu satir bug'i yakalar.
    rnd.mockReturnValue(0.99);
    const oracle = await quizService.answerQuestion(SESSION, SOLVER, undefined, 'ORACLE');
    expect(powerResult(oracle).suggested_answer_index).toBe(1);

    // Fixture'da questionCountMultipliers '3' anahtari yok → calculatePowerCost 1.0
    // fallback'i: HALF 10 + ORACLE 15 mor; hedefe 2 + 3 yesil.
    expect(userRow(fake, SOLVER).purple_diamonds).toBe(25);
    expect(userRow(fake, TARGET).green_diamonds).toBe(5);
  });

  it('ucundan uca ORACLE→HALF: yanlis oneri HALF sonrasi hayatta kalir', async () => {
    const { fake, quizService } = await setup();

    // ORACLE fazi (0.99): yanlis dal, havuz [1,3,4] → 4.
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const oracle = await quizService.answerQuestion(SESSION, SOLVER, undefined, 'ORACLE');
    expect(powerResult(oracle).suggested_answer_index).toBe(4);

    // HALF fazi (0.1): duzeltme oncesi havuz [1,3,4] → [3,4,1] → {3,4} = 4 elenirdi.
    rnd.mockReturnValue(0.1);
    const half = await quizService.answerQuestion(SESSION, SOLVER, undefined, 'HALF');
    expect(sorted(powerResult(half).removed_indices)).toEqual([1, 3]);
    expect(sessionRow(fake).current_q_oracle).toBe(4);
  });
});

describe('QuizService.answerQuestion — soru gecisi', () => {
  it('dogru cevap sonraki soruya gecerken HALF ve ORACLE izini sifirlar', async () => {
    const { fake, quizService } = await setup({
      quiz_sessions: [session({
        current_q_eliminated: [3, 4], current_q_oracle: 1, current_q_powers: ['HALF', 'ORACLE'],
      })],
    });

    const reply = await quizService.answerQuestion(SESSION, SOLVER, 2);

    expect(reply).toMatchObject({ is_correct: true, next_question: 2 });
    expect(sessionRow(fake)).toMatchObject({
      current_q: 2, current_q_powers: [], current_q_eliminated: [], current_q_oracle: null,
    });
  });
});
