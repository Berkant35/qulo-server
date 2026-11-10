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

/**
 * Sesli/görselli soru (2.0.18+101): süre uzatması + imzalı medya URL'leri. Uzatma yalnız `active`
 * (sürüm ≥ 2.0.18+101 + `media_questions_enabled`) iken; eski istemcide yanıt ve son an BİREBİR eski.
 */
const MEDIA_BUCKET = 'question-media';
const VOICE = `${TARGET}/${Q1}/voice-1.m4a`;
const IMAGE = `${TARGET}/${Q1}/image-1.jpg`;
const mediaQ1 = (over: Record<string, unknown> = {}) => question(Q1, {
  voice_path: VOICE, voice_duration_ms: 12_400, image_path: IMAGE, image_status: 'approved', ...over,
});
const mediaSeed = (sessionOver: Record<string, unknown> = {}, qOver: Record<string, unknown> = {}): Tables => ({
  questions: [mediaQ1(qOver), question(Q2, { order_num: 2, time_limit: 60 })],
  quiz_sessions: [session(sessionOver)],
});
const mediaStorage: FakeSupabaseOptions = { storage: { [MEDIA_BUCKET]: [VOICE, IMAGE] } };
const ACTIVE = { active: true } as const;

/** Medya özelliğinden önceki yanıt sözleşmesi — eski istemci (≤ 2.0.18) bunu alır. */
const LEGACY_KEYS = [
  'answers', 'expires_at', 'has_hint', 'question_id', 'question_number', 'question_text',
  'remaining_seconds', 'session_id', 'time_limit_seconds', 'total_questions', 'used_powers',
];

describe('mediaExtraSeconds — saf hesap', () => {
  async function load() {
    await setup();
    return (await import('../../src/services/quiz-deadline.service.js')).mediaExtraSeconds;
  }

  it('ses (yukarı yuvarlanır) + 3 sn, onaylı görsel + 3 sn', async () => {
    const mediaExtraSeconds = await load();
    expect(mediaExtraSeconds({ voice_duration_ms: 12_400, image_status: 'approved' })).toBe(19);
  });

  it('medyasız / bekleyen görsel → 0', async () => {
    const mediaExtraSeconds = await load();
    expect(mediaExtraSeconds({ voice_duration_ms: null, image_status: 'pending' })).toBe(0);
    expect(mediaExtraSeconds({ voice_duration_ms: null, image_status: 'rejected' })).toBe(0);
    expect(mediaExtraSeconds({ voice_duration_ms: null, image_status: null })).toBe(0);
  });

  it('yalnız ses → ceil + 3', async () => {
    const mediaExtraSeconds = await load();
    expect(mediaExtraSeconds({ voice_duration_ms: 8000, image_status: null })).toBe(11);
  });

  it('sınır dışı süre ses üst sınırına (15 sn) kırpılır — bozuk satır süreyi şişiremez', async () => {
    const mediaExtraSeconds = await load();
    expect(mediaExtraSeconds({ voice_duration_ms: 600_000, image_status: null })).toBe(18);
  });
});

describe('getCurrentQuestion — eski istemci (medya kapalı) birebir eski', () => {
  for (const [label, media] of [['argümansız', undefined], ['active:false', { active: false }]] as const) {
    it(`${label}: yanıt anahtarları eski küme, son an eski hesap, imza/işaret yok`, async () => {
      const { fake, quizService } = await setup(mediaSeed(), mediaStorage);
      const storageFrom = vi.spyOn(fake.client.storage, 'from');

      const reply = await quizService.getCurrentQuestion(SESSION, SOLVER, media);

      // Doğrudan kanıt (review fix 4): işaret RPC'si yok, imza/depolama isteği yok.
      expect(fake.rpcCalls).toEqual([]);
      expect(storageFrom).not.toHaveBeenCalled();
      expect(Object.keys(reply).sort()).toEqual(LEGACY_KEYS);
      expect(secondsLeft(row(fake).expires_at)).toBe(30); // 20 + 10 — medya uzatması yok
      expect(reply.remaining_seconds).toBe(30);
      expect(reply.time_limit_seconds).toBe(20);
      expect(row(fake).current_q_powers).toEqual([]);
      expect(JSON.stringify(reply)).not.toContain('question-media');
    });
  }
});

describe('getCurrentQuestion — medya açık (2.0.18+101)', () => {
  it('imzalı URL + süre; son an "şimdi + süre + uzatma + tolerans"a kurulur', async () => {
    const { fake, quizService } = await setup(mediaSeed(), mediaStorage);

    const reply = await quizService.getCurrentQuestion(SESSION, SOLVER, ACTIVE);

    expect(reply.voice_url).toContain(`/sign/${MEDIA_BUCKET}/${VOICE}?expiresIn=600`);
    expect(reply.image_url).toContain(`/sign/${MEDIA_BUCKET}/${IMAGE}?expiresIn=600`);
    expect(reply.voice_duration_ms).toBe(12_400);
    expect(reply.media_extra_seconds).toBe(19);
    expect(reply.time_limit_seconds).toBe(20); // taban süre; istemci uzatmayı ayrıca okur
    expect(secondsLeft(row(fake).expires_at)).toBe(49); // 20 + 19 + 10
    expect(reply.remaining_seconds).toBe(49);
    expect(reply.expires_at).toBe(row(fake).expires_at);
    expect(JSON.stringify(reply)).not.toContain('"voice_path"');
  });

  it('uzatma geçiş tamponunu aşsa da ilk sunumda verilir (yalnız daraltan arm bunu kaçırırdı)', async () => {
    // Geçişten sonra son an 30 sn'ye inmiş (geç gelen GET): 20 + 19 + 10 = 49 > 30.
    const { fake, quizService } = await setup(mediaSeed({ expires_at: at(30) }), mediaStorage);

    const reply = await quizService.getCurrentQuestion(SESSION, SOLVER, ACTIVE);

    expect(secondsLeft(row(fake).expires_at)).toBe(49);
    expect(reply.remaining_seconds).toBe(49);
  });

  it('tekrar çekmek uzatmayı yeniden eklemez (süre kazanma yolu yok)', async () => {
    const { fake, quizService } = await setup(mediaSeed({ expires_at: at(30) }), mediaStorage);
    await quizService.getCurrentQuestion(SESSION, SOLVER, ACTIVE); // 49
    const armed = row(fake).expires_at;

    vi.setSystemTime(new Date(NOW.getTime() + 15_000));
    const again = await quizService.getCurrentQuestion(SESSION, SOLVER, ACTIVE);

    expect(row(fake).expires_at).toBe(armed);
    expect(again.remaining_seconds).toBe(34);
    expect(again.media_extra_seconds).toBe(19);
  });

  it('ilk sunum daraltsa da ikinci sunum uzatamaz (önce erken çek, sonra geç çek)', async () => {
    const { quizService } = await setup(mediaSeed(), mediaStorage); // son an 60
    await quizService.getCurrentQuestion(SESSION, SOLVER, ACTIVE); // 60 → 49 daraltma

    vi.setSystemTime(new Date(NOW.getTime() + 40_000)); // 9 sn kaldı
    const again = await quizService.getCurrentQuestion(SESSION, SOLVER, ACTIVE);

    expect(again.remaining_seconds).toBe(9);
  });

  it('TIME_EXTEND sonrası ikinci arm uzatmayı tekrar eklemez', async () => {
    const { fake, quizService } = await setup(mediaSeed(), mediaStorage);
    await quizService.getCurrentQuestion(SESSION, SOLVER, ACTIVE); // 49
    await quizService.answerQuestion(SESSION, SOLVER, undefined, 'TIME_EXTEND'); // 64
    expect(row(fake).current_q_powers).toContain('TIME_EXTEND');

    vi.setSystemTime(new Date(NOW.getTime() + 2_000));
    const again = await quizService.getCurrentQuestion(SESSION, SOLVER, ACTIVE);

    expect(secondsLeft(row(fake).expires_at)).toBe(62);
    expect(again.remaining_seconds).toBe(62);
  });

  it('sürüm başlığı oyunu: kapalı GET daraltır, geç açık GET geçen süreyi geri alamaz (review fix 1)', async () => {
    const { fake, quizService } = await setup(mediaSeed(), mediaStorage); // geçiş son anı 60
    await quizService.getCurrentQuestion(SESSION, SOLVER, { active: false }); // t1 = 0 → 20 + 10 = 30

    vi.setSystemTime(new Date(NOW.getTime() + 29_000)); // 1 sn kaldı, başlık 2.0.19'a çevrildi
    const reply = await quizService.getCurrentQuestion(SESSION, SOLVER, ACTIVE);

    // Tavan: t1 + L + tol + E = 0 + 20 + 10 + 19 = 49 (tavansız 29 + 49 = 78 olurdu).
    expect(secondsLeft(row(fake).expires_at)).toBe(20); // şimdi = 29 → son an 49
    expect(new Date(row(fake).expires_at).getTime() - NOW.getTime()).toBeLessThanOrEqual(49_000);
    expect(reply.remaining_seconds).toBe(20);
  });

  it('işaret RPC hatası + başarılı tekrar GET: kazanç en çok bir ek E (review fix 2)', async () => {
    let calls = 0;
    const flakyMark = (args: { p_session_id: string; p_power: string }, table: (n: string) => Row[]) =>
      (calls++ === 0 ? { data: null, error: { message: 'boom' } } : markPower(args, table));
    const { fake, quizService } = await setup(mediaSeed(), {
      ...mediaStorage,
      rpc: { quiz_session_mark_power: flakyMark, quiz_session_unmark_power: unmarkPower },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await quizService.getCurrentQuestion(SESSION, SOLVER, ACTIVE); // t1 = 0, işaretsiz daraltma → 49

    vi.setSystemTime(new Date(NOW.getTime() + 30_000)); // 19 sn kaldı
    await quizService.getCurrentQuestion(SESSION, SOLVER, ACTIVE); // işaret alınır, yükseltme tavanlı

    // Sınır: t1 + L + tol + 2E = 0 + 20 + 10 + 38 = 68 (tavansız 30 + 49 = 79 olurdu).
    const bound = 68_000;
    expect(new Date(row(fake).expires_at).getTime() - NOW.getTime()).toBe(bound);

    vi.setSystemTime(new Date(NOW.getTime() + 40_000));
    await quizService.getCurrentQuestion(SESSION, SOLVER, ACTIVE); // işaret var → üçüncü ek yok
    expect(new Date(row(fake).expires_at).getTime() - NOW.getTime()).toBe(bound);
  });

  it('iç medya işareti istemciye used_powers içinde dönmez', async () => {
    const { quizService } = await setup(mediaSeed(), mediaStorage);
    await quizService.getCurrentQuestion(SESSION, SOLVER, ACTIVE);

    const again = await quizService.getCurrentQuestion(SESSION, SOLVER, ACTIVE);

    expect(again.used_powers).toEqual([]);
  });

  it('bekleyen görsel: URL yok, görsel uzatması yok (yalnız ses)', async () => {
    const { fake, quizService } = await setup(mediaSeed({}, { image_status: 'pending' }), mediaStorage);

    const reply = await quizService.getCurrentQuestion(SESSION, SOLVER, ACTIVE);

    expect(reply.image_url).toBeNull();
    expect(reply.voice_url).not.toBeNull();
    expect(reply.media_extra_seconds).toBe(16); // 13 + 3
    expect(secondsLeft(row(fake).expires_at)).toBe(46);
  });

  it('medyasız soru: alanlar null/0, son an eski hesap, işaret yazılmaz', async () => {
    const { fake, quizService } = await setup();

    const reply = await quizService.getCurrentQuestion(SESSION, SOLVER, ACTIVE);

    expect(reply).toMatchObject({ voice_url: null, voice_duration_ms: null, image_url: null, media_extra_seconds: 0 });
    expect(secondsLeft(row(fake).expires_at)).toBe(30);
    expect(row(fake).current_q_powers).toEqual([]);
  });

  it('işaret yazılamazsa uzatma verilmez (fail-closed), daraltma yine çalışır', async () => {
    const { fake, quizService } = await setup(mediaSeed({ expires_at: at(30) }), {
      ...mediaStorage,
      rpc: { quiz_session_mark_power: () => ({ data: null, error: { message: 'boom' } }) },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const reply = await quizService.getCurrentQuestion(SESSION, SOLVER, ACTIVE);

    expect(secondsLeft(row(fake).expires_at)).toBe(30); // uzamadı
    expect(reply.remaining_seconds).toBe(30);
  });

  it('imza hatası yanıtı patlatmaz: URL null, süre DB durumundan', async () => {
    const { quizService } = await setup(mediaSeed(), {
      ...mediaStorage,
      storageFailOn: [{ bucket: MEDIA_BUCKET, op: 'sign' }],
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const reply = await quizService.getCurrentQuestion(SESSION, SOLVER, ACTIVE);

    expect(reply.voice_url).toBeNull();
    expect(reply.image_url).toBeNull();
    expect(reply.media_extra_seconds).toBe(19);
  });
});

describe('time_spent — reddedilmez, istatistik için kırpılır (review fix 3)', () => {
  const slow = (over: Record<string, unknown> = {}) => question(Q1, { time_limit: 300, ...over });

  it('300 sn soruda 250 sn cevap kabul edilir ve olduğu gibi yazılır', async () => {
    const { fake, quizService } = await setup({
      questions: [slow(), question(Q2, { order_num: 2, time_limit: 60 })],
      quiz_sessions: [session({ expires_at: at(300) })],
    });

    await quizService.answerQuestion(SESSION, SOLVER, 2, undefined, 250);

    expect(fake.table('quiz_answers')[0].time_spent).toBe(250);
    expect(fake.table('questions')[0].stats_total_time_spent).toBe(250);
  });

  it('akıl dışı süre üst sınıra kırpılır — istatistik zehirlenmez', async () => {
    const { fake, quizService } = await setup({
      questions: [slow(), question(Q2, { order_num: 2, time_limit: 60 })],
      quiz_sessions: [session({ expires_at: at(300) })],
    });
    const { MAX_TIME_SPENT_SECONDS } = await import('../../src/services/quiz-deadline.service.js');

    await quizService.answerQuestion(SESSION, SOLVER, 2, undefined, 10_000_000);

    expect(MAX_TIME_SPENT_SECONDS).toBeGreaterThanOrEqual(300 + 21 + 10); // soru + medya + tolerans
    expect(fake.table('quiz_answers')[0].time_spent).toBe(MAX_TIME_SPENT_SECONDS);
    expect(fake.table('questions')[0].stats_total_time_spent).toBe(MAX_TIME_SPENT_SECONDS);
  });
});
