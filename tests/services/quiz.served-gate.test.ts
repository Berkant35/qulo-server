import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';

/**
 * quiz/start gösterim kapısı (spec 2026-10-06 kehanet açığı). Hak harcamayan quiz/start, bilinen
 * bir UUID'nin tercihini öğrenmenin ucuz yoluydu; Discover'ın göstermediği ya da etkileşilmemiş
 * hedef, var olmayan hedefle aynı 404'ü alır. Gerçek appConfig + blockService (fake tablolar).
 */

const SOLVER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const Q1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const Q2 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString();

const question = (id: string, order_num: number) => ({
  id, user_id: TARGET, order_num, question_text: 'En sevdigim renk?',
  correct_answer: 2, answer_1: 'Kirmizi', answer_2: 'Mavi', answer_3: 'Yesil', answer_4: 'Sari',
  hint_text: null, time_limit: 20, locale: 'tr', created_at: '2026-08-01T00:00:00.000Z',
  stats_correct: 0, stats_wrong: 0, stats_solve_count: 0, stats_total_time_spent: 0,
  stats_copy_used: 0, stats_half_used: 0, stats_hint_used: 0, stats_time_extend_used: 0,
  stats_skip_used: 0, stats_answer_1_count: 0, stats_answer_2_count: 0,
  stats_answer_3_count: 0, stats_answer_4_count: 0, stats_green_earned: 0,
});

async function setup(opts: { gate: boolean; mutual?: boolean; targetPref?: string; over?: Partial<Tables> }) {
  const seed: Tables = {
    economy_config_versions: [activeConfigRow()],
    app_config: [{ id: 'cfg', mutual_match_enabled: opts.mutual ?? false, served_gate_enabled: opts.gate }],
    users: [
      { id: SOLVER, gender: 'MAN', gender_pref: 'MAN', purple_diamonds: 50, purple_paid: 0, green_diamonds: 0, is_deleted: false, preferred_languages: ['tr'], locale: 'tr' },
      { id: TARGET, gender: 'MAN', gender_pref: opts.targetPref ?? 'MAN', purple_diamonds: 0, purple_paid: 0, green_diamonds: 0, rainbow_diamonds: 0, is_deleted: false },
    ],
    powers: [], questions: [question(Q1, 1), question(Q2, 2)],
    quiz_sessions: [], quiz_answers: [], user_power_inventory: [],
    discover_served: [], swipes: [], matches: [], blocks: [],
    ...opts.over,
  };
  const fake = createFakeSupabase(seed);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { quizService } = await import('../../src/services/quiz.service.js');
  return { fake, quizService };
}

const served = () => [{ viewer_id: SOLVER, target_id: TARGET, served_at: daysAgo(2) }];

beforeEach(() => vi.resetModules());
afterEach(() => vi.restoreAllMocks());

describe('startSession — gösterim kapısı', () => {
  it('anahtar açık + gösterilmemiş hedef: USER_NOT_FOUND 404, oturum açılmaz, hedefin soruları okunmaz', async () => {
    const { fake, quizService } = await setup({ gate: true });
    const err = await quizService.startSession(SOLVER, TARGET).catch((e) => e);
    expect(err).toMatchObject({ code: 'USER_NOT_FOUND', statusCode: 404 });
    expect(fake.table('quiz_sessions')).toHaveLength(0);
    expect(fake.queries.filter((q) => q.table === 'questions' || q.table === 'quiz_sessions' && q.op !== 'select')).toHaveLength(0);
  });

  it('anahtar açık + gösterilmiş hedef: oturum açılır', async () => {
    const { fake, quizService } = await setup({ gate: true, over: { discover_served: served() } });
    await quizService.startSession(SOLVER, TARGET);
    expect(fake.table('quiz_sessions')).toHaveLength(1);
  });

  it('anahtar açık + 30 günden eski gösterim: 404', async () => {
    const { fake, quizService } = await setup({
      gate: true, over: { discover_served: [{ viewer_id: SOLVER, target_id: TARGET, served_at: daysAgo(31) }] },
    });
    await expect(quizService.startSession(SOLVER, TARGET)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
    expect(fake.table('quiz_sessions')).toHaveLength(0);
  });

  it('anahtar açık + gösterim yok ama önceki LIKE var: oturum açılır', async () => {
    const { fake, quizService } = await setup({
      gate: true, over: { swipes: [{ id: 'sw', swiper_id: SOLVER, target_id: TARGET, action: 'LIKE', created_at: daysAgo(40) }] },
    });
    await quizService.startSession(SOLVER, TARGET);
    expect(fake.table('quiz_sessions')).toHaveLength(1);
  });

  it('gösterilmiş ama uyumsuz hedef: gösterilmemiş hedefle AYNI 404 yanıtı', async () => {
    const a = await setup({ gate: true, mutual: true, targetPref: 'WOMAN', over: { discover_served: served() } });
    const uyumsuz = await a.quizService.startSession(SOLVER, TARGET).catch((e) => e);
    vi.resetModules();
    const b = await setup({ gate: true, mutual: true, targetPref: 'MAN' });
    const gosterilmemis = await b.quizService.startSession(SOLVER, TARGET).catch((e) => e);
    expect([uyumsuz.code, uyumsuz.statusCode, uyumsuz.message])
      .toEqual([gosterilmemis.code, gosterilmemis.statusCode, gosterilmemis.message]);
    expect(uyumsuz.code).toBe('USER_NOT_FOUND');
    expect(a.fake.table('quiz_sessions')).toHaveLength(0);
  });

  it.each([
    ['çözen engelledi', { blocker_id: SOLVER, blocked_id: TARGET }],
    ['hedef engelledi', { blocker_id: TARGET, blocked_id: SOLVER }],
  ])('engel (%s), anahtar kapalı da: 404, oturum açılmaz', async (_ad, engel) => {
    const { fake, quizService } = await setup({ gate: false, over: { blocks: [{ id: 'b', ...engel }], discover_served: served() } });
    await expect(quizService.startSession(SOLVER, TARGET)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
    expect(fake.table('quiz_sessions')).toHaveLength(0);
  });

  it('anahtar kapalı: gösterilmemiş hedefte eskisi gibi oturum açılır', async () => {
    const { fake, quizService } = await setup({ gate: false });
    await quizService.startSession(SOLVER, TARGET);
    expect(fake.table('quiz_sessions')).toHaveLength(1);
  });
});
