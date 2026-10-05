import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';

const SOLVER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const Q1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const Q2 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';

const question = (id: string, order_num: number) => ({
  id, user_id: TARGET, order_num, question_text: 'En sevdigim renk?',
  correct_answer: 2, answer_1: 'Kirmizi', answer_2: 'Mavi', answer_3: 'Yesil', answer_4: 'Sari',
  hint_text: null, time_limit: 20, locale: 'tr', created_at: '2026-08-01T00:00:00.000Z',
  stats_correct: 0, stats_wrong: 0, stats_solve_count: 0, stats_total_time_spent: 0,
  stats_copy_used: 0, stats_half_used: 0, stats_hint_used: 0, stats_time_extend_used: 0,
  stats_skip_used: 0, stats_answer_1_count: 0, stats_answer_2_count: 0,
  stats_answer_3_count: 0, stats_answer_4_count: 0, stats_green_earned: 0,
});

async function setup(solverPref: string, targetPref: string, mutual: boolean) {
  const seed: Tables = {
    economy_config_versions: [activeConfigRow()],
    app_config: [{ id: 'cfg', mutual_match_enabled: mutual }],
    users: [
      { id: SOLVER, gender: 'MAN', gender_pref: solverPref, purple_diamonds: 50, purple_paid: 0, green_diamonds: 0, is_deleted: false, preferred_languages: ['tr'], locale: 'tr' },
      { id: TARGET, gender: 'MAN', gender_pref: targetPref, purple_diamonds: 0, purple_paid: 0, green_diamonds: 0, rainbow_diamonds: 0, is_deleted: false },
    ],
    powers: [], questions: [question(Q1, 1), question(Q2, 2)],
    quiz_sessions: [], quiz_answers: [], user_power_inventory: [],
  };
  const fake = createFakeSupabase(seed);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { quizService } = await import('../../src/services/quiz.service.js');
  return { fake, quizService };
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.restoreAllMocks());

describe('startSession — karşılıklı eşleşme guard\'ı', () => {
  it('anahtar açık + uyumsuz (gey → hetero erkek): NOT_COMPATIBLE, oturum açılmaz', async () => {
    const { fake, quizService } = await setup('MAN', 'WOMAN', true);
    const err = await quizService.startSession(SOLVER, TARGET).catch((e) => e);
    expect(err.code).toBe('NOT_COMPATIBLE');
    expect(fake.table('quiz_sessions')).toHaveLength(0);
  });

  it('anahtar açık + uyumlu (gey → gey): oturum açılır', async () => {
    const { fake, quizService } = await setup('MAN', 'MAN', true);
    await quizService.startSession(SOLVER, TARGET);
    expect(fake.table('quiz_sessions')).toHaveLength(1);
  });

  it('anahtar kapalı: uyumsuz çift de eskisi gibi oturum açar', async () => {
    const { fake, quizService } = await setup('MAN', 'WOMAN', false);
    await quizService.startSession(SOLVER, TARGET);
    expect(fake.table('quiz_sessions')).toHaveLength(1);
  });
});
