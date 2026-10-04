import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';
import { DEFAULT_QUIZ_ONBOARDING } from '../../src/types/economy-config.schema.js';
import { evaluateRetry, type RetrySessionRow } from '../../src/services/quiz-retry.service.js';

/**
 * Başarısız quiz'in hedefine tek tekrar (kullanıcı kararı 2026-10-04, ilk gün tutma planı #4).
 * Kural `evaluateRetry`'da; Discover (matching testleri) ve `startSession` kapısı aynı sonucu kullanır.
 */

const SOLVER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const Q1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const Q2 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
const NOW = new Date('2026-10-04T12:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const failed = (d: number, over: Partial<RetrySessionRow> = {}): RetrySessionRow => ({
  target_id: TARGET, status: 'FAILED', started_at: daysAgo(d), completed_at: daysAgo(d),
  expires_at: daysAgo(d), ...over,
});

describe('evaluateRetry — kural', () => {
  const opts = { retryDays: 7, now: NOW };

  it('başarısız oturum yoksa fresh', () => {
    expect(evaluateRetry([], opts).verdict).toBe('fresh');
  });

  it('tek başarısızlık, 7 gün dolmadı → cooldown ve açılış anı', () => {
    const r = evaluateRetry([failed(3)], opts);
    expect(r.verdict).toBe('cooldown');
    expect(r.retryAt?.toISOString()).toBe(new Date(Date.parse(daysAgo(3)) + 7 * 86_400_000).toISOString());
  });

  it('tek başarısızlık, 7 gün doldu → eligible', () => {
    expect(evaluateRetry([failed(7)], opts).verdict).toBe('eligible');
  });

  it('iki başarısızlık → exhausted (ilk deneme + 1 tekrar)', () => {
    expect(evaluateRetry([failed(20), failed(8)], opts).verdict).toBe('exhausted');
  });

  it('retryDays 0 → disabled (özellik kapalı)', () => {
    expect(evaluateRetry([failed(30)], { retryDays: 0, now: NOW }).verdict).toBe('disabled');
  });

  it('süresi geçmiş IN_PROGRESS başarısızlık sayılır, son an = expires_at', () => {
    const r = evaluateRetry(
      [{ target_id: TARGET, status: 'IN_PROGRESS', started_at: daysAgo(9), completed_at: null, expires_at: daysAgo(8) }],
      opts,
    );
    expect(r.verdict).toBe('eligible');
    expect(r.lastFailedAt?.toISOString()).toBe(daysAgo(8));
  });

  it('süren IN_PROGRESS en sondaysa open (devam ettirilir)', () => {
    const live = { target_id: TARGET, status: 'IN_PROGRESS', started_at: daysAgo(0), completed_at: null, expires_at: new Date(NOW.getTime() + 60_000).toISOString() };
    expect(evaluateRetry([failed(9), live], opts).verdict).toBe('open');
  });

  it('başarısızlıktan SONRA eklenmiş soru beklemeyi atlatır; öncekiler atlatmaz', () => {
    expect(evaluateRetry([failed(3)], { ...opts, questionCreatedAts: [daysAgo(1)] }).verdict).toBe('eligible');
    expect(evaluateRetry([failed(3)], { ...opts, questionCreatedAts: [daysAgo(30), null] }).verdict).toBe('cooldown');
  });

  it('soru değişikliği tükenmiş hakkı geri açmaz', () => {
    expect(evaluateRetry([failed(20), failed(5)], { ...opts, questionCreatedAts: [daysAgo(1)] }).verdict).toBe('exhausted');
  });

  it('varsayılan bekleme 7 gün', () => {
    expect(DEFAULT_QUIZ_ONBOARDING.failedRetryDays).toBe(7);
  });
});

// ─── startSession kapısı ───────────────────────────────────────

const question = (id: string, over: Record<string, unknown> = {}) => ({
  id, user_id: TARGET, order_num: 1, question_text: 'En sevdigim renk?',
  correct_answer: 2, answer_1: 'Kirmizi', answer_2: 'Mavi', answer_3: 'Yesil', answer_4: 'Sari',
  hint_text: null, time_limit: 20, locale: 'tr', created_at: daysAgo(60),
  stats_correct: 0, stats_wrong: 0, stats_solve_count: 0, stats_total_time_spent: 0,
  stats_copy_used: 0, stats_half_used: 0, stats_hint_used: 0, stats_time_extend_used: 0,
  stats_skip_used: 0, stats_answer_1_count: 0, stats_answer_2_count: 0,
  stats_answer_3_count: 0, stats_answer_4_count: 0, stats_green_earned: 0, ...over,
});

const sessionRow = (id: string, over: Record<string, unknown> = {}) => ({
  id, solver_id: SOLVER, target_id: TARGET, status: 'FAILED', started_at: daysAgo(3),
  current_q: 1, total_questions: 2, expires_at: daysAgo(3), completed_at: daysAgo(3),
  question_ids: [Q1, Q2], current_q_powers: [], current_q_eliminated: [], current_q_oracle: null, ...over,
});

async function setup(seed: Tables = {}, retryDays = 7) {
  const fake = createFakeSupabase({
    economy_config_versions: [activeConfigRow({
      quizOnboarding: { ...DEFAULT_QUIZ_ONBOARDING, failedRetryDays: retryDays },
    })],
    users: [
      { id: SOLVER, purple_diamonds: 50, purple_paid: 0, green_diamonds: 0, is_deleted: false, preferred_languages: ['tr'], locale: 'tr' },
      { id: TARGET, purple_diamonds: 0, purple_paid: 0, green_diamonds: 0, rainbow_diamonds: 0, is_deleted: false },
    ],
    powers: [],
    questions: [question(Q1), question(Q2, { order_num: 2 })],
    quiz_sessions: [],
    quiz_answers: [],
    user_power_inventory: [],
    ...seed,
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { quizService } = await import('../../src/services/quiz.service.js');
  return { fake, quizService };
}

const codeOf = async (p: Promise<unknown>) => p.then(() => 'OK', (e: { code?: string }) => e.code ?? String(e));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startSession — tekrar kapısı', () => {
  it('ilk deneme (geçmiş yok) eskisi gibi oturum açar', async () => {
    const { fake, quizService } = await setup();
    await quizService.startSession(SOLVER, TARGET);
    expect(fake.table('quiz_sessions')).toHaveLength(1);
  });

  it('bekleme sürerken QUIZ_RETRY_LOCKED (cooldown + retry_at), oturum açılmaz', async () => {
    const { fake, quizService } = await setup({ quiz_sessions: [sessionRow('s1')] });
    const err = await quizService.startSession(SOLVER, TARGET).catch((e) => e);
    expect(err.code).toBe('QUIZ_RETRY_LOCKED');
    expect(err.statusCode).toBe(409);
    expect(err.params).toEqual({ reason: 'cooldown', retry_at: new Date(Date.parse(daysAgo(3)) + 7 * 86_400_000).toISOString() });
    expect(fake.table('quiz_sessions')).toHaveLength(1);
  });

  it('bekleme dolunca tekrar oturumu açılır (Discover\'a dönen profil reddedilmez)', async () => {
    const { fake, quizService } = await setup({ quiz_sessions: [sessionRow('s1', { started_at: daysAgo(8), completed_at: daysAgo(8) })] });
    expect(await codeOf(quizService.startSession(SOLVER, TARGET))).toBe('OK');
    expect(fake.table('quiz_sessions').filter((s) => s.status === 'IN_PROGRESS')).toHaveLength(1);
  });

  it('hak bittiyse (2 başarısızlık) reddedilir', async () => {
    const { quizService } = await setup({
      quiz_sessions: [
        sessionRow('s1', { started_at: daysAgo(30), completed_at: daysAgo(30) }),
        sessionRow('s2', { started_at: daysAgo(10), completed_at: daysAgo(10) }),
      ],
    });
    const err = await quizService.startSession(SOLVER, TARGET).catch((e) => e);
    expect(err.params?.reason).toBe('exhausted');
  });

  it('özellik kapalıyken (0) başarısız hedefe tekrar yok', async () => {
    const { quizService } = await setup({ quiz_sessions: [sessionRow('s1', { started_at: daysAgo(30), completed_at: daysAgo(30) })] }, 0);
    const err = await quizService.startSession(SOLVER, TARGET).catch((e) => e);
    expect(err.params?.reason).toBe('disabled');
  });

  it('hedef başarısızlıktan sonra yeni soru eklediyse bekleme atlanır', async () => {
    const { quizService } = await setup({
      quiz_sessions: [sessionRow('s1')],
      questions: [question(Q1), question(Q2, { order_num: 2, created_at: daysAgo(1) })],
    });
    expect(await codeOf(quizService.startSession(SOLVER, TARGET))).toBe('OK');
  });

  it('son oturum COMPLETED ise (eşleşip ayrılmış) kapı uygulanmaz — eski davranış', async () => {
    const { quizService } = await setup({
      quiz_sessions: [
        sessionRow('s1', { started_at: daysAgo(30), completed_at: daysAgo(30) }),
        sessionRow('s2', { status: 'COMPLETED', started_at: daysAgo(2), completed_at: daysAgo(2) }),
      ],
    });
    expect(await codeOf(quizService.startSession(SOLVER, TARGET))).toBe('OK');
  });

  it('bayat oturum sonradan açılınca FAILED kapanır, bitiş = expires_at (bekleme ileri itilmez)', async () => {
    const expiredAt = new Date(NOW.getTime() - 3 * 3_600_000).toISOString();
    const { fake, quizService } = await setup({
      quiz_sessions: [sessionRow('stale', { status: 'IN_PROGRESS', started_at: daysAgo(0), completed_at: null, expires_at: expiredAt })],
    });
    expect(await codeOf(quizService.getCurrentQuestion('stale', SOLVER))).toBe('TIME_UP');
    expect(fake.table('quiz_sessions')[0]).toMatchObject({ status: 'FAILED', completed_at: expiredAt });
  });

  it('süren oturum devam ettirilir (kapı uygulanmaz, yeni satır yok)', async () => {
    const live = sessionRow('live', { status: 'IN_PROGRESS', started_at: daysAgo(0), completed_at: null, expires_at: new Date(NOW.getTime() + 60_000).toISOString() });
    const { fake, quizService } = await setup({ quiz_sessions: [sessionRow('s1', { started_at: daysAgo(30), completed_at: daysAgo(30) }), live] });
    const res = await quizService.startSession(SOLVER, TARGET);
    expect(res.session_id).toBe('live');
    expect(fake.table('quiz_sessions')).toHaveLength(2);
  });

  it('süresi geçmiş yarım oturum FAILED kapanır (bitiş = expires_at) ve tekrar beklemesi başlar', async () => {
    const expiredAt = new Date(NOW.getTime() - 60_000).toISOString();
    const { fake, quizService } = await setup({
      quiz_sessions: [sessionRow('half', { status: 'IN_PROGRESS', started_at: daysAgo(0), completed_at: null, expires_at: expiredAt })],
    });
    const err = await quizService.startSession(SOLVER, TARGET).catch((e) => e);
    expect(err.params?.reason).toBe('cooldown');
    const half = fake.table('quiz_sessions').find((s) => s.id === 'half')!;
    expect(half.status).toBe('FAILED');
    expect(half.completed_at).toBe(expiredAt);
  });
});

describe('ezber riski — başarısız quiz yanıtları doğru cevabı taşımaz', () => {
  const live = () => sessionRow('live', {
    status: 'IN_PROGRESS', started_at: daysAgo(0), completed_at: null,
    expires_at: new Date(NOW.getTime() + 600_000).toISOString(),
  });

  it('yanlış cevap yanıtında doğru indeks / metin yok', async () => {
    const { quizService } = await setup({ quiz_sessions: [live()] });
    const reply = await quizService.answerQuestion('live', SOLVER, 1);
    const json = JSON.stringify(reply);
    expect(reply).toMatchObject({ is_correct: false });
    expect(json).not.toMatch(/correct_answer|correct_index|Mavi/);
  });

  it('vazgeç (fail) yanıtı yalnız durum döner; sonuç yalnız çözücünün kendi seçimlerini içerir', async () => {
    const { quizService } = await setup({
      quiz_sessions: [live()],
      quiz_answers: [{ id: 'a1', session_id: 'live', question_id: Q1, selected_answer: 1, is_correct: false, power_used: null, created_at: daysAgo(0) }],
    });
    expect(await quizService.failSession('live', SOLVER)).toEqual({ session_status: 'FAILED' });
    const result = await quizService.getSessionResult('live', SOLVER);
    expect(JSON.stringify(result)).not.toMatch(/correct_answer|Mavi/);
    expect(result.answers).toEqual([expect.objectContaining({ question_id: Q1, is_correct: false })]);
  });

  it('SKIP ile kurtarılan sorunun doğru cevabı (selected_answer) başarısız oturumun sonucunda dönmez', async () => {
    const { quizService } = await setup({
      quiz_sessions: [sessionRow('f1')],
      quiz_answers: [
        { id: 'a1', session_id: 'f1', question_id: Q1, selected_answer: 2, is_correct: true, power_used: 'SKIP', created_at: daysAgo(3) },
        { id: 'a2', session_id: 'f1', question_id: Q2, selected_answer: 1, is_correct: false, power_used: null, created_at: daysAgo(3) },
      ],
    });
    const result = await quizService.getSessionResult('f1', SOLVER);
    expect(result.answers).toHaveLength(2);
    for (const a of result.answers as Record<string, unknown>[]) expect(a).not.toHaveProperty('selected_answer');
  });

  it('eşleşmeyle biten oturumda sonuç eskisi gibi seçimleri içerir', async () => {
    const { quizService } = await setup({
      quiz_sessions: [sessionRow('c1', { status: 'COMPLETED' })],
      quiz_answers: [{ id: 'a1', session_id: 'c1', question_id: Q1, selected_answer: 2, is_correct: true, power_used: null, created_at: daysAgo(3) }],
    });
    const result = await quizService.getSessionResult('c1', SOLVER);
    expect(result.answers).toEqual([expect.objectContaining({ selected_answer: 2 })]);
  });
});
