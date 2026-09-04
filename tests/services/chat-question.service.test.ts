import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';

/**
 * Chat sorusu guc akisi — bu servisin ilk testleri.
 *
 * Dogum sebebi: ORACLE ile HALF birbirinden habersizdi (sonuclari yazilmiyordu).
 * HALF→ORACLE: yanlis dal 2/3 olasilikla ELENMIS sikki oneriyordu. ORACLE→HALF: HALF
 * ORACLE'in yanlis onerisini 2/3 olasilikla eliyordu. Ikisi de "ORACLE yanlisti"
 * bilgisini bedavaya veriyordu. Simdi iki sonuc da satira yazilir.
 *
 * `Math.random` sabitlenir: ORACLE'da 0.99 → yanlis dal (accuracy 0.7), 0.1 → dogru dal.
 * HALF'ta `shuffleArray` (Fisher-Yates) 0.1 ile deterministik: [x,y,z] → [y,z,x].
 */

const ANSWERER = '11111111-1111-4111-8111-111111111111';
const SENDER = '22222222-2222-4222-8222-222222222222';
const MATCH = '33333333-3333-4333-8333-333333333333';
const QUESTION = '44444444-4444-4444-8444-444444444444';

const user = (id: string, over: Record<string, unknown> = {}) => ({
  id, purple_diamonds: 50, green_diamonds: 0, ...over,
});

/** Servis maliyeti economy config'ten okur; `powers` satiri sadece accuracy_rate icin. */
const power = (name: string) => ({
  id: `p-${name}`, name, is_active: true, accuracy_rate: 0.7, special_green_reward: 0,
});

/** 4 sikli, dogru cevabi A olan, henuz cevaplanmamis soru. */
const question = (over: Record<string, unknown> = {}) => ({
  id: QUESTION, match_id: MATCH, sender_id: SENDER,
  question_text: 'En sevdigim sehir?', option_count: 4,
  option_a: 'Izmir', option_b: 'Ankara', option_c: 'Bursa', option_d: 'Van',
  correct_option: 'A', hint_text: null, time_limit_seconds: 30,
  answered_option: null, is_correct: null, is_abandoned: false,
  has_power_block: false, power_block_removed: false, powers_used: [],
  eliminated_options: null, oracle_suggested_option: null, ...over,
});

type Fake = ReturnType<typeof createFakeSupabase>;

async function setup(seed: Tables = {}, options: FakeSupabaseOptions = {}) {
  const fake = createFakeSupabase(
    {
      economy_config_versions: [activeConfigRow()],
      users: [user(ANSWERER), user(SENDER)],
      matches: [{ id: MATCH, user1_id: SENDER, user2_id: ANSWERER, is_active: true }],
      powers: [power('ORACLE'), power('HALF')],
      chat_questions: [question()],
      ...seed,
    },
    {
      // Isaretleme RPC'si gercek DB'de atomik calisir; fake'te sadece "basarili" doner.
      rpc: { chat_question_mark_power: { data: true } },
      ...options,
    },
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { chatQuestionService } = await import('../../src/services/chat-question.service.js');
  return { fake, chatQuestionService };
}

const questionRow = (fake: Fake) => fake.table('chat_questions')[0];
const userRow = (fake: Fake, id: string) => fake.table('users').find((u) => u.id === id)!;
const sorted = (xs: readonly string[] | null | undefined) => [...(xs ?? [])].sort();

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatQuestionService.usePower — HALF', () => {
  it('elenen iki yanlis sikki satira yazar', async () => {
    const { fake, chatQuestionService } = await setup();

    const result = await chatQuestionService.usePower(QUESTION, ANSWERER, 'HALF');

    expect(result.eliminated_options).toHaveLength(2);
    expect(result.eliminated_options).not.toContain('A');
    expect(questionRow(fake).eliminated_options).toEqual(result.eliminated_options);
  });

  it('ORACLE daha once onerdiyse o sikki elemez — ters sira sizintisi kapali', async () => {
    const { fake, chatQuestionService } = await setup({
      chat_questions: [question({ oracle_suggested_option: 'D', powers_used: ['ORACLE'] })],
    });

    const result = await chatQuestionService.usePower(QUESTION, ANSWERER, 'HALF');

    // Havuz {B, C}: ikisi de elenir, D hayatta kalir.
    expect(sorted(result.eliminated_options)).toEqual(['B', 'C']);
    expect(sorted(questionRow(fake).eliminated_options)).toEqual(['B', 'C']);
  });

  it('2 sikli soruda reddedilir — ucret alinmaz, guc isaretlenmez', async () => {
    const { fake, chatQuestionService } = await setup({
      chat_questions: [question({ option_count: 2, option_c: null, option_d: null })],
    });

    await expect(chatQuestionService.usePower(QUESTION, ANSWERER, 'HALF'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(userRow(fake, ANSWERER).purple_diamonds).toBe(50);
    expect(fake.rpcCalls).toHaveLength(0);
    expect(questionRow(fake).eliminated_options).toBeNull();
  });

  it('envanterde hak varsa once oradan duser, mor elmasa dokunmaz', async () => {
    const { fake, chatQuestionService } = await setup({
      user_power_inventory: [{ id: 'inv-1', user_id: ANSWERER, power_name: 'HALF', count: 2 }],
    });

    await chatQuestionService.usePower(QUESTION, ANSWERER, 'HALF');

    expect(fake.table('user_power_inventory')[0].count).toBe(1);
    expect(userRow(fake, ANSWERER).purple_diamonds).toBe(50);
  });

  it('ayni guc ikinci kez basilirsa ucret alinmaz, sonuc yazilmaz', async () => {
    const { fake, chatQuestionService } = await setup({}, {
      rpc: { chat_question_mark_power: { data: false } }, // RPC "zaten isaretli" der
    });

    await expect(chatQuestionService.usePower(QUESTION, ANSWERER, 'HALF'))
      .rejects.toMatchObject({ code: 'POWER_ALREADY_USED' });

    expect(userRow(fake, ANSWERER).purple_diamonds).toBe(50);
    expect(userRow(fake, SENDER).green_diamonds).toBe(0);
    expect(questionRow(fake).eliminated_options).toBeNull();
  });

  it('sonuc yazilamazsa istek yine basarili doner — kullanici zaten odedi', async () => {
    const { fake, chatQuestionService } = await setup({}, {
      failOn: [{ table: 'chat_questions', op: 'update', error: { message: 'boom' } }],
    });

    const result = await chatQuestionService.usePower(QUESTION, ANSWERER, 'HALF');

    expect(result.eliminated_options).toHaveLength(2);
    expect(userRow(fake, ANSWERER).purple_diamonds).toBe(40);
    expect(questionRow(fake).eliminated_options).toBeNull();
  });
});

describe('ChatQuestionService.usePower — ORACLE', () => {
  it('HALF sonrasi yanlis dalinda bile elenmis sikki onermez', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { chatQuestionService } = await setup({
      chat_questions: [question({ eliminated_options: ['C', 'D'], powers_used: ['HALF'] })],
    });

    const result = await chatQuestionService.usePower(QUESTION, ANSWERER, 'ORACLE');

    // Havuz {A, B}; yanlis dali kalan tek yanlisi (B) onermeli.
    expect(result.suggested_option).toBe('B');
  });

  it('HALF sonrasi dogru dalinda dogru sikki onerir', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const { chatQuestionService } = await setup({
      chat_questions: [question({ eliminated_options: ['C', 'D'], powers_used: ['HALF'] })],
    });

    const result = await chatQuestionService.usePower(QUESTION, ANSWERER, 'ORACLE');

    expect(result.suggested_option).toBe('A');
  });

  it('HALF kullanilmadiysa tum yanlis siklardan secer', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { chatQuestionService } = await setup();

    const result = await chatQuestionService.usePower(QUESTION, ANSWERER, 'ORACLE');

    expect(['B', 'C', 'D']).toContain(result.suggested_option);
  });

  it('onerisini satira yazar — sonraki HALF ve reload icin', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { fake, chatQuestionService } = await setup();

    const result = await chatQuestionService.usePower(QUESTION, ANSWERER, 'ORACLE');

    expect(questionRow(fake).oracle_suggested_option).toBe(result.suggested_option);
  });

  it('ucundan uca HALF→ORACLE: elenmis sikki onermez, ucret ve odul birikir', async () => {
    const { fake, chatQuestionService } = await setup();

    // HALF fazi (0.1): Fisher-Yates [B,C,D] → [C,D,B] → elenen {C,D}, kalan tek yanlis B.
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const half = await chatQuestionService.usePower(QUESTION, ANSWERER, 'HALF');
    expect(sorted(half.eliminated_options)).toEqual(['C', 'D']);

    // ORACLE fazi (0.99): yanlis dal. Duzeltme oncesi havuz [B,C,D], floor(0.99×3)=2 → 'D'
    // (ELENMIS). Duzeltme sonrasi havuz [B] → 'B'. Bu satir bug'i yakalar.
    rnd.mockReturnValue(0.99);
    const oracle = await chatQuestionService.usePower(QUESTION, ANSWERER, 'ORACLE');
    expect(oracle.suggested_option).toBe('B');

    // HALF 10 + ORACLE 15 mor; gonderene floor(10×0.25) + floor(15×0.25) = 2 + 3 yesil.
    expect(userRow(fake, ANSWERER).purple_diamonds).toBe(25);
    expect(userRow(fake, SENDER).green_diamonds).toBe(5);
  });

  it('ucundan uca ORACLE→HALF: yanlis oneri HALF sonrasi hayatta kalir', async () => {
    const { fake, chatQuestionService } = await setup();

    // ORACLE fazi (0.99): yanlis dal, havuz [B,C,D] → 'D'.
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const oracle = await chatQuestionService.usePower(QUESTION, ANSWERER, 'ORACLE');
    expect(oracle.suggested_option).toBe('D');

    // HALF fazi (0.1): duzeltme oncesi havuz [B,C,D] → [C,D,B] → {C,D} = D elenirdi.
    rnd.mockReturnValue(0.1);
    const half = await chatQuestionService.usePower(QUESTION, ANSWERER, 'HALF');
    expect(sorted(half.eliminated_options)).toEqual(['B', 'C']);
    expect(questionRow(fake)).toMatchObject({ oracle_suggested_option: 'D' });
  });
});

describe('ChatQuestionService.getQuestion', () => {
  it('cevaplayana guc sonuclarini verir, dogru cevabi gizler', async () => {
    const { chatQuestionService } = await setup({
      chat_questions: [question({
        eliminated_options: ['C', 'D'], oracle_suggested_option: 'B', powers_used: ['HALF', 'ORACLE'],
      })],
    });

    const q = await chatQuestionService.getQuestion(QUESTION, ANSWERER);

    expect(q.eliminated_options).toEqual(['C', 'D']);
    expect(q.oracle_suggested_option).toBe('B');
    expect(q.correct_option).toBe('');
  });
});
