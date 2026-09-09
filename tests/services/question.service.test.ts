import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';

/**
 * Soru servisi — profil gorunurlugu buna bagli (kesif min 2 soru istiyor).
 *
 * Iki davranis merkezde:
 * 1. SILME SONRASI SIRA YENIDEN DIZILIYOR. `order_num` uzerinde unique index var
 *    (migration 029) ve istemci sorulari bu sirayla gosteriyor; bosluk kalirsa
 *    hem UI hem sonraki ekleme bozulur.
 * 2. `reorderByIds` TAM KUME istiyor: gelen id listesi kullanicinin butun
 *    sorularini icermeli. Eksik/fazla/yabanci id reddediliyor — yabanci id
 *    araya sokma girisimi de burada duruyor.
 *
 * `time_limit` dogrulamasi ayri dosyada (question.service.time-limit.test.ts).
 */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const q = (id: string, userId: string, orderNum: number, over: Record<string, unknown> = {}) => ({
  id, user_id: userId, order_num: orderNum,
  question_text: `Soru ${orderNum}`, correct_answer: 1,
  answer_1: 'A', answer_2: 'B', answer_3: 'C', answer_4: 'D',
  locale: 'tr', ...over,
});

async function setup(seed: Tables = {}, opts?: FakeSupabaseOptions) {
  const fake = createFakeSupabase({
    economy_config_versions: [activeConfigRow()],
    users: [{ id: A, subscription_plan: null }, { id: B, subscription_plan: null }],
    questions: [],
    ...seed,
  }, opts);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { questionService } = await import('../../src/services/question.service.js');
  return { fake, questionService };
}

beforeEach(() => {
  vi.resetModules();
});

describe('getMyQuestions / getQuestionCount — kullanici izolasyonu', () => {
  it('yalnizca kendi sorularini doner', async () => {
    const { questionService } = await setup({
      questions: [q('q1', A, 1), q('q2', B, 1), q('q3', A, 2)],
    });

    const mine = await questionService.getMyQuestions(A);

    expect(mine.map((x: { id: string }) => x.id)).toEqual(['q1', 'q3']);
  });

  it('sira numarasina gore artan dizer', async () => {
    const { questionService } = await setup({
      questions: [q('q3', A, 3), q('q1', A, 1), q('q2', A, 2)],
    });

    const mine = await questionService.getMyQuestions(A);

    expect(mine.map((x: { order_num: number }) => x.order_num)).toEqual([1, 2, 3]);
  });

  it('sayim da yalnizca kendi sorularini kapsar', async () => {
    const { questionService } = await setup({
      questions: [q('q1', A, 1), q('q2', B, 1), q('q3', B, 2)],
    });

    expect(await questionService.getQuestionCount(A)).toEqual({ count: 1 });
    expect(await questionService.getQuestionCount(B)).toEqual({ count: 2 });
  });

  it('sorusu olmayan kullanici bos liste / sifir alir', async () => {
    const { questionService } = await setup();

    expect(await questionService.getMyQuestions(A)).toEqual([]);
    expect(await questionService.getQuestionCount(A)).toEqual({ count: 0 });
  });
});

describe('deleteQuestion — silme ve sira yeniden dizilmesi', () => {
  it('ORTADAKI soru silinince kalanlar 1..n olarak yeniden dizilir', async () => {
    // `order_num` uzerinde unique index var (migration 029) ve istemci bu
    // sirayla gosteriyor; bosluk kalirsa sonraki ekleme de bozulur.
    const { fake, questionService } = await setup({
      questions: [q('q1', A, 1), q('q2', A, 2), q('q3', A, 3)],
    });

    await questionService.deleteQuestion(A, 2);

    const rows = fake.table('questions')
      .filter((r) => r.user_id === A)
      .sort((x, y) => (x.order_num as number) - (y.order_num as number));
    expect(rows.map((r) => r.id)).toEqual(['q1', 'q3']);
    expect(rows.map((r) => r.order_num)).toEqual([1, 2]);
  });

  it('SONDAKI soru silinince kalanlarin sirasi degismez', async () => {
    const { fake, questionService } = await setup({
      questions: [q('q1', A, 1), q('q2', A, 2)],
    });

    await questionService.deleteQuestion(A, 2);

    const rows = fake.table('questions').filter((r) => r.user_id === A);
    expect(rows).toHaveLength(1);
    expect(rows[0].order_num).toBe(1);
  });

  it('BASKASININ sorusunu silemez ve o satira dokunulmaz', async () => {
    const { fake, questionService } = await setup({
      questions: [q('qB', B, 1)],
    });

    await expect(questionService.deleteQuestion(A, 1)).rejects.toBeTruthy();
    expect(fake.table('questions')).toHaveLength(1);
  });

  it('olmayan sira numarasi hata verir', async () => {
    const { questionService } = await setup({ questions: [q('q1', A, 1)] });

    await expect(questionService.deleteQuestion(A, 9)).rejects.toBeTruthy();
  });

  it('BASKA kullanicinin siralamasina dokunmaz', async () => {
    const { fake, questionService } = await setup({
      questions: [q('a1', A, 1), q('a2', A, 2), q('b1', B, 1), q('b2', B, 2)],
    });

    await questionService.deleteQuestion(A, 1);

    const bRows = fake.table('questions').filter((r) => r.user_id === B);
    expect(bRows.map((r) => r.order_num).sort()).toEqual([1, 2]);
  });
});

describe('reorderByIds — TAM KUME kurali', () => {
  const three = { questions: [q('q1', A, 1), q('q2', A, 2), q('q3', A, 3)] };

  it('tam kume verilince RPC ile atomik siralama yapilir', async () => {
    // Siralama tek transaction'da (DEFERRED constraint) yapiliyor; tek tek
    // update unique index'e takilirdi.
    const { fake, questionService } = await setup(three, {
      rpc: { reorder_questions: { data: null } },
    });

    await questionService.reorderByIds(A, ['q3', 'q1', 'q2']);

    expect(fake.rpcCalls).toHaveLength(1);
    expect(fake.rpcCalls[0]).toMatchObject({
      name: 'reorder_questions',
      args: { p_user_id: A, p_ordered_ids: ['q3', 'q1', 'q2'] },
    });
  });

  it('EKSIK id reddedilir — sessizce yarim siralama olmasin', async () => {
    const { fake, questionService } = await setup(three);

    await expect(questionService.reorderByIds(A, ['q1', 'q2'])).rejects.toMatchObject({
      code: 'INVALID_REORDER',
    });
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it('YABANCI id reddedilir — baskasinin sorusu araya sokulamaz', async () => {
    // Ayni sayida ama biri baskasinin: sayim kontrolu tek basina yetmez,
    // her id kullaniciya ait olmali.
    const { fake, questionService } = await setup({
      questions: [q('q1', A, 1), q('q2', A, 2), q('q3', A, 3), q('qB', B, 1)],
    });

    await expect(questionService.reorderByIds(A, ['q1', 'q2', 'qB'])).rejects.toMatchObject({
      code: 'INVALID_REORDER',
    });
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it('FAZLA id reddedilir', async () => {
    const { questionService } = await setup(three);

    await expect(
      questionService.reorderByIds(A, ['q1', 'q2', 'q3', 'q3']),
    ).rejects.toMatchObject({ code: 'INVALID_REORDER' });
  });

  it('RPC patlarsa hata yukselir — siralama yapildi sanilmasin', async () => {
    const { questionService } = await setup(three, {
      rpc: { reorder_questions: { error: { code: 'P0001', message: 'deadlock' } } },
    });

    await expect(questionService.reorderByIds(A, ['q3', 'q2', 'q1'])).rejects.toBeTruthy();
  });
});
