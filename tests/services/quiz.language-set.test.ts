import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';
import { MIN_QUIZ_QUESTIONS, selectQuizQuestions } from '../../src/utils/quiz-question-set.js';

/**
 * K3 (2026-11-17): Discover yabanci dildeki gercek profili de gosterir; quiz ayni profilde
 * NO_QUESTIONS atmamali. Soru kumesi tek fonksiyonda (`selectQuizQuestions`); startSession ve
 * oturumu yeniden hesaplayan tum yollar onu kullanir.
 */

const SOLVER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const qid = (n: number) => `dddddddd-dddd-4ddd-8ddd-ddddddddddd${n}`;

const question = (n: number, locale: string) => ({
  id: qid(n), user_id: TARGET, order_num: n, question_text: `Soru ${n}`,
  correct_answer: 2, answer_1: 'a', answer_2: 'b', answer_3: 'c', answer_4: 'd',
  hint_text: null, time_limit: 30, locale, created_at: '2026-01-01T00:00:00Z',
  stats_correct: 0, stats_wrong: 0, stats_solve_count: 0, stats_total_time_spent: 0,
  stats_copy_used: 0, stats_half_used: 0, stats_hint_used: 0, stats_time_extend_used: 0,
  stats_skip_used: 0, stats_answer_1_count: 0, stats_answer_2_count: 0,
  stats_answer_3_count: 0, stats_answer_4_count: 0, stats_green_earned: 0,
});

async function setup(locales: string[], seed: Tables = {}) {
  const fake = createFakeSupabase({
    economy_config_versions: [activeConfigRow()],
    users: [
      { id: SOLVER, purple_diamonds: 50, purple_paid: 0, green_diamonds: 0, is_deleted: false, preferred_languages: ['tr'], locale: 'tr' },
      { id: TARGET, purple_diamonds: 0, purple_paid: 0, green_diamonds: 0, rainbow_diamonds: 0, is_deleted: false },
    ],
    powers: [],
    questions: locales.map((l, i) => question(i + 1, l)),
    quiz_sessions: [],
    quiz_answers: [],
    user_power_inventory: [],
    ...seed,
  }, { rpc: { quiz_session_mark_power: { data: true } } });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { quizService } = await import('../../src/services/quiz.service.js');
  return { fake, quizService };
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.restoreAllMocks());

describe('selectQuizQuestions', () => {
  const q = (locale: string, id: number) => ({ id, locale });
  it('izleyici dilinde >= 2 soru varsa yalniz onlar (eski davranis)', () => {
    expect(selectQuizQuestions([q('de', 1), q('tr', 2), q('tr', 3)], ['tr']).map((x) => x.id)).toEqual([2, 3]);
  });
  it('< 2 ise tum sorular, izleyici dili once, her grupta gelen sira', () => {
    expect(selectQuizQuestions([q('de', 1), q('de', 2), q('tr', 3), q('fr', 4)], ['tr']).map((x) => x.id)).toEqual([3, 1, 2, 4]);
  });
  it('toplam < esik bos doner; dil listesi bossa hepsi', () => {
    expect(selectQuizQuestions([q('de', 1)], ['tr'])).toEqual([]);
    expect(selectQuizQuestions([q('de', 1), q('fr', 2)], [])).toHaveLength(MIN_QUIZ_QUESTIONS);
  });
  it('locale NULL/bos questionLocale ile normalize edilir (tr sayilir)', () => {
    expect(selectQuizQuestions([{ id: 1, locale: null }, { id: 2, locale: '' }, q('de', 3)], ['tr']).map((x) => x.id)).toEqual([1, 2]);
  });
});

describe('startSession — yabanci dil hedefi (K3)', () => {
  const ids = (fake: Awaited<ReturnType<typeof setup>>['fake']) => fake.table('quiz_sessions')[0].question_ids as string[];

  it('izleyici dilinde soru yok: quiz baslar ve hedefin TUM sorularini alir', async () => {
    const { fake, quizService } = await setup(['de', 'de', 'de']);
    const res = await quizService.startSession(SOLVER, TARGET);
    expect(res.total_questions).toBe(3);
    expect(ids(fake)).toEqual([qid(1), qid(2), qid(3)]);
  });

  it('izleyici dilinde >= 2 soru: yalniz onlar (yabanci sorular gelmez)', async () => {
    const { fake, quizService } = await setup(['de', 'tr', 'tr']);
    const res = await quizService.startSession(SOLVER, TARGET);
    expect(res.total_questions).toBe(2);
    expect(ids(fake)).toEqual([qid(2), qid(3)]);
  });

  it('karisik (1 kendi + 2 yabanci): izleyici dili once', async () => {
    const { fake, quizService } = await setup(['de', 'de', 'tr']);
    await quizService.startSession(SOLVER, TARGET);
    expect(ids(fake)).toEqual([qid(3), qid(1), qid(2)]);
  });

  it('toplam soru < 2: yine NO_QUESTIONS', async () => {
    const { fake, quizService } = await setup(['de']);
    await expect(quizService.startSession(SOLVER, TARGET)).rejects.toMatchObject({ code: 'NO_QUESTIONS' });
    expect(fake.table('quiz_sessions')).toHaveLength(0);
  });

  it('cevaplama ve tamamlama oturuma yazilan AYNI kumeyle calisir', async () => {
    const { fake, quizService } = await setup(['de', 'de']);
    const { session_id } = await quizService.startSession(SOLVER, TARGET);
    const cur = await quizService.getCurrentQuestion(session_id, SOLVER);
    expect(cur.question_id).toBe(qid(1));
    expect(await quizService.answerQuestion(session_id, SOLVER, 2)).toMatchObject({ is_correct: true, next_question: 2 });
    const last = await quizService.answerQuestion(session_id, SOLVER, 2);
    expect(last).toMatchObject({ is_correct: true });
    expect(fake.table('quiz_sessions')[0].status).toBe('COMPLETED');
    expect(fake.table('quiz_answers')).toHaveLength(2);
  });

  it('eski oturum (question_ids yok): getCurrentQuestion ayni kumeyi yeniden hesaplar', async () => {
    const { quizService } = await setup(['de', 'de', 'tr'], {
      quiz_sessions: [{
        id: SESSION, solver_id: SOLVER, target_id: TARGET, status: 'IN_PROGRESS', current_q: 1, total_questions: 3,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(), completed_at: null, question_ids: null,
        current_q_powers: [], current_q_eliminated: [], current_q_oracle: null,
      }],
    });
    const cur = await quizService.getCurrentQuestion(SESSION, SOLVER);
    expect(cur.question_id).toBe(qid(3));
  });
});
