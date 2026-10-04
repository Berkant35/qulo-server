import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions, type Row } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';

/**
 * Quiz süre kuralları (2026-10-04, ilk gün tutma planı): `expires_at` artık SORU BAŞINA son an.
 *
 * Eski kural "tüm soru süreleri + 10 sn" paywall / güç sayfası / soru geçişi sırasında da
 * işliyordu: istemci sayacı dururken sunucu süresi bitiyor, kullanıcı TIME_UP alıyordu.
 *
 * Fixture timing: tolerans 10, geçiş tamponu 30, paywall 180, kurtarma penceresi 300, TIME_EXTEND 15.
 * Saat sabit (`vi.setSystemTime`), süreler saniye cinsinden `secondsLeft` ile okunur.
 */

const SOLVER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const Q1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const Q2 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
const NOW = new Date('2026-10-04T12:00:00.000Z');

const question = (id: string, over: Record<string, unknown> = {}) => ({
  id, user_id: TARGET, order_num: 1, question_text: 'En sevdigim renk?',
  correct_answer: 2, answer_1: 'Kirmizi', answer_2: 'Mavi', answer_3: 'Yesil', answer_4: 'Sari',
  hint_text: null, time_limit: 20, locale: 'tr',
  stats_correct: 0, stats_wrong: 0, stats_solve_count: 0, stats_total_time_spent: 0,
  stats_copy_used: 0, stats_half_used: 0, stats_hint_used: 0, stats_time_extend_used: 0,
  stats_skip_used: 0, stats_answer_1_count: 0, stats_answer_2_count: 0,
  stats_answer_3_count: 0, stats_answer_4_count: 0, stats_green_earned: 0, ...over,
});

const at = (secondsFromNow: number) => new Date(Date.now() + secondsFromNow * 1000).toISOString();

const session = (over: Record<string, unknown> = {}) => ({
  id: SESSION, solver_id: SOLVER, target_id: TARGET, status: 'IN_PROGRESS',
  started_at: NOW.toISOString(), current_q: 1, total_questions: 2,
  expires_at: at(60), completed_at: null,
  question_ids: [Q1, Q2], current_q_powers: [], current_q_eliminated: [],
  current_q_oracle: null, ...over,
});

/** 037 `quiz_session_mark_power`'ın depo üzerindeki etkisi: yoksa ekle → true, varsa false. */
const markPower = (args: { p_session_id: string; p_power: string }, table: (n: string) => Row[]) => {
  const row = table('quiz_sessions').find((r) => r.id === args.p_session_id);
  if (!row) return { data: false };
  const powers: string[] = row.current_q_powers ?? [];
  if (powers.includes(args.p_power)) return { data: false };
  row.current_q_powers = [...powers, args.p_power];
  return { data: true };
};
const unmarkPower = (args: { p_session_id: string; p_power: string }, table: (n: string) => Row[]) => {
  const row = table('quiz_sessions').find((r) => r.id === args.p_session_id);
  if (row) row.current_q_powers = (row.current_q_powers ?? []).filter((p: string) => p !== args.p_power);
  return { data: null };
};

async function setup(seed: Tables = {}, options: FakeSupabaseOptions = {}) {
  const fake = createFakeSupabase(
    {
      economy_config_versions: [activeConfigRow()],
      users: [
        { id: SOLVER, purple_diamonds: 50, purple_paid: 0, green_diamonds: 0, is_deleted: false, preferred_languages: ['tr'], locale: 'tr' },
        { id: TARGET, purple_diamonds: 0, purple_paid: 0, green_diamonds: 0, rainbow_diamonds: 0, is_deleted: false },
      ],
      powers: [
        { id: 'p-TE', name: 'TIME_EXTEND', is_active: true, base_cost: 5, accuracy_rate: 1 },
        { id: 'p-HALF', name: 'HALF', is_active: true, base_cost: 10, accuracy_rate: 1 },
      ],
      questions: [question(Q1), question(Q2, { order_num: 2, time_limit: 60 })],
      quiz_sessions: [session()],
      quiz_answers: [],
      user_power_inventory: [],
      ...seed,
    },
    { rpc: { quiz_session_mark_power: markPower, quiz_session_unmark_power: unmarkPower }, ...options },
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { quizService } = await import('../../src/services/quiz.service.js');
  return { fake, quizService };
}

const row = (fake: ReturnType<typeof createFakeSupabase>) => fake.table('quiz_sessions')[0];
const secondsLeft = (iso: string) => Math.round((new Date(iso).getTime() - Date.now()) / 1000);

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startSession — ilk sorunun son anı', () => {
  it('toplam süre değil: ilk soru + tolerans + geçiş tamponu', async () => {
    const { fake, quizService } = await setup({ quiz_sessions: [] });

    await quizService.startSession(SOLVER, TARGET);

    // 20 (ilk soru) + 10 + 30 = 60. Eski kural 20 + 60 + 10 = 90 verirdi.
    expect(secondsLeft(fake.table('quiz_sessions')[0].expires_at)).toBe(60);
  });
});

describe('getCurrentQuestion — sunumda daraltma', () => {
  it('son anı "şimdi + süre + tolerans"a daraltır ve kalan süreyi döner', async () => {
    const { fake, quizService } = await setup();

    const reply = await quizService.getCurrentQuestion(SESSION, SOLVER);

    expect(secondsLeft(row(fake).expires_at)).toBe(30); // 20 + 10
    expect(reply.expires_at).toBe(row(fake).expires_at);
    expect(reply.remaining_seconds).toBe(30);
    expect(reply.time_limit_seconds).toBe(20);
  });

  it('aynı soruyu sonra tekrar çekmek süreyi sıfırlamaz (süre kazanma yolu yok)', async () => {
    const { fake, quizService } = await setup();
    await quizService.getCurrentQuestion(SESSION, SOLVER);
    const armed = row(fake).expires_at;

    vi.setSystemTime(new Date(NOW.getTime() + 15_000));
    const again = await quizService.getCurrentQuestion(SESSION, SOLVER);

    expect(row(fake).expires_at).toBe(armed);
    expect(again.remaining_seconds).toBe(15);
  });

  it('istemciye iç paywall işaretini göstermez', async () => {
    const { quizService } = await setup({
      quiz_sessions: [session({ current_q_powers: ['HALF', '__PAYWALL_GRACE'] })],
    });

    const reply = await quizService.getCurrentQuestion(SESSION, SOLVER);

    expect(reply.used_powers).toEqual(['HALF']);
  });
});

describe('soru geçişi — sonraki sorunun son anı', () => {
  it('doğru cevapta sonraki soru süresi + tolerans + geçiş tamponu kurulur', async () => {
    const { fake, quizService } = await setup();

    await quizService.answerQuestion(SESSION, SOLVER, 2);

    expect(row(fake).current_q).toBe(2);
    expect(secondsLeft(row(fake).expires_at)).toBe(100); // Q2: 60 + 10 + 30
  });

  it('geçiş tamponu animasyonu karşılar; sunumda yine soru süresine daralır', async () => {
    const { fake, quizService } = await setup();
    await quizService.answerQuestion(SESSION, SOLVER, 2);

    vi.setSystemTime(new Date(NOW.getTime() + 3_000)); // geri bildirim animasyonu
    const reply = await quizService.getCurrentQuestion(SESSION, SOLVER);

    expect(reply.remaining_seconds).toBe(70); // 60 + 10, animasyon süresinden bağımsız
    expect(secondsLeft(row(fake).expires_at)).toBe(70);
  });
});

describe('TIME_EXTEND', () => {
  it('sunucu son anını da config süresi kadar uzatır ve aynı süreyi döner', async () => {
    const { fake, quizService } = await setup({ quiz_sessions: [session({ expires_at: at(30) })] });

    const reply = await quizService.answerQuestion(SESSION, SOLVER, undefined, 'TIME_EXTEND');

    expect((reply as { power_result: { extra_seconds: number } }).power_result.extra_seconds).toBe(15);
    expect(secondsLeft(row(fake).expires_at)).toBe(45);
  });
});

describe('paywall ek süresi', () => {
  const broke = (over: Record<string, unknown> = {}) => ({
    id: SOLVER, purple_diamonds: 0, purple_paid: 0, green_diamonds: 0, ...over,
  });

  it('yetersiz elmasta son an soru başına bir kez uzar; hata yine istemciye gider', async () => {
    const { fake, quizService } = await setup({
      users: [broke(), { id: TARGET, purple_diamonds: 0, purple_paid: 0, green_diamonds: 0 }],
      quiz_sessions: [session({ expires_at: at(25) })],
    });

    await expect(quizService.answerQuestion(SESSION, SOLVER, undefined, 'HALF'))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_DIAMONDS' });
    expect(secondsLeft(row(fake).expires_at)).toBe(205); // 25 + 180
    // Güç işareti geri alındı (tekrar denenebilir), paywall işareti kaldı.
    expect(row(fake).current_q_powers).toEqual(['__PAYWALL_GRACE']);

    // İkinci yetersiz deneme: ek süre tekrar verilmez.
    await expect(quizService.answerQuestion(SESSION, SOLVER, undefined, 'HALF'))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_DIAMONDS' });
    expect(secondsLeft(row(fake).expires_at)).toBe(205);
  });

  it('paywall sonrası satın alıp gücü kullanınca TIME_UP almaz', async () => {
    const { fake, quizService } = await setup({
      users: [broke(), { id: TARGET, purple_diamonds: 0, purple_paid: 0, green_diamonds: 0 }],
      quiz_sessions: [session({ expires_at: at(25) })],
    });
    await expect(quizService.answerQuestion(SESSION, SOLVER, undefined, 'HALF')).rejects.toBeTruthy();

    // Kullanıcı 2 dk paywall'da kaldı, satın aldı (eski kuralda son an 25 sn sonra bitmişti).
    vi.setSystemTime(new Date(NOW.getTime() + 120_000));
    fake.table('users')[0].purple_diamonds = 50;

    const reply = await quizService.answerQuestion(SESSION, SOLVER, undefined, 'HALF');
    expect((reply as { awaiting_answer?: boolean }).awaiting_answer).toBe(true);
  });

  it('elmas dışı hata ek süre vermez', async () => {
    const { fake, quizService } = await setup(
      { quiz_sessions: [session({ expires_at: at(25) })] },
      { failOn: [{ table: 'users', op: 'select', failAfter: 0 }] },
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(quizService.answerQuestion(SESSION, SOLVER, undefined, 'HALF')).rejects.toBeTruthy();
    expect(secondsLeft(row(fake).expires_at)).toBe(25);
  });
});

describe('yanlış cevap — kurtarma penceresi', () => {
  it('son an kurtarma penceresine uzar: paywall + kurtarma TIME_UP almaz', async () => {
    const { fake, quizService } = await setup({ quiz_sessions: [session({ expires_at: at(5) })] });

    const reply = await quizService.answerQuestion(SESSION, SOLVER, 1);

    expect((reply as { can_rescue?: boolean }).can_rescue).toBe(true);
    expect(secondsLeft(row(fake).expires_at)).toBe(300);
  });
});

describe('ek süre tekrar çekmeyle "taze süre"ye dönmez (server-review M1/L1)', () => {
  it('paywall ek süresinden sonra soruyu tekrar çekmek son anı değiştirmez', async () => {
    const { fake, quizService } = await setup({
      users: [
        { id: SOLVER, purple_diamonds: 0, purple_paid: 0, green_diamonds: 0 },
        { id: TARGET, purple_diamonds: 0, purple_paid: 0, green_diamonds: 0 },
      ],
    });
    await quizService.getCurrentQuestion(SESSION, SOLVER); // 30 sn
    vi.setSystemTime(new Date(NOW.getTime() + 25_000)); // 5 sn kaldı
    await expect(quizService.answerQuestion(SESSION, SOLVER, undefined, 'HALF')).rejects.toBeTruthy();
    expect(secondsLeft(row(fake).expires_at)).toBe(185); // 5 + 180

    vi.setSystemTime(new Date(NOW.getTime() + 200_000)); // paywall'dan 175 sn sonra dön
    const again = await quizService.getCurrentQuestion(SESSION, SOLVER);

    // Daraltma olsaydı "şimdi + 30" taze süre verirdi; kalan 10 sn korunur.
    expect(again.remaining_seconds).toBe(10);
  });

  it('TIME_EXTEND sonrası tekrar çekmek ödenmiş süreyi geri almaz', async () => {
    const { fake, quizService } = await setup();
    await quizService.getCurrentQuestion(SESSION, SOLVER); // 30
    await quizService.answerQuestion(SESSION, SOLVER, undefined, 'TIME_EXTEND'); // 45

    vi.setSystemTime(new Date(NOW.getTime() + 2_000));
    await quizService.getCurrentQuestion(SESSION, SOLVER);

    expect(secondsLeft(row(fake).expires_at)).toBe(43);
  });

  it('kurtarma penceresi açıkken soruyu tekrar çekmek pencereyi daraltmaz', async () => {
    const { fake, quizService } = await setup();
    await quizService.answerQuestion(SESSION, SOLVER, 1); // yanlış → 300 sn

    const again = await quizService.getCurrentQuestion(SESSION, SOLVER);

    expect(secondsLeft(row(fake).expires_at)).toBe(300);
    expect(again.remaining_seconds).toBe(300);
    expect(again.used_powers).toEqual([]);
  });
});

describe('eş zamanlı yazımlar (server-review M2/M3)', () => {
  it('daraltma yarışı kaybedilirse eski anlık görüntü değil taze son an döner', async () => {
    const { quizService } = await setup({}, {
      // getCurrentQuestion okuduktan sonra başka bir GET son anı 25 sn'ye daraltmış olsun.
      interleave: [{ table: 'quiz_sessions', op: 'update', mutate: (rows) => { rows[0].expires_at = at(25); } }],
    });

    const reply = await quizService.getCurrentQuestion(SESSION, SOLVER);

    expect(reply.remaining_seconds).toBe(25); // snapshot olsaydı 60
  });

  it('uzatma, araya giren yazımı ezmez — taze değerin üstüne ekler', async () => {
    const { fake, quizService } = await setup({ quiz_sessions: [session({ expires_at: at(30) })] }, {
      // TIME_EXTEND okuduktan sonra son an 40 sn'ye taşınmış olsun (ör. başka bir uzatma).
      interleave: [{ table: 'quiz_sessions', op: 'update', mutate: (rows) => { rows[0].expires_at = at(40); } }],
    });

    await quizService.answerQuestion(SESSION, SOLVER, undefined, 'TIME_EXTEND');

    expect(secondsLeft(row(fake).expires_at)).toBe(55); // 40 + 15 (eski kod 30 + 15 yazardı)
  });
});

describe('süre dolunca', () => {
  it('son an geçmişse TIME_UP ve oturum FAILED (kural değişmedi)', async () => {
    const { fake, quizService } = await setup({ quiz_sessions: [session({ expires_at: at(-1) })] });

    await expect(quizService.answerQuestion(SESSION, SOLVER, 2)).rejects.toMatchObject({ code: 'TIME_UP' });
    expect(row(fake).status).toBe('FAILED');
  });
});
