import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';
import { SHORT_CODE_ALPHABET } from '../../src/utils/short-code.js';
import { hashIp } from '../../src/utils/hash.js';

/**
 * Web testi — hesapsız, herkese açık uç. Para yok ama iki kural para kadar önemli:
 * doğru cevap oynayan kişiye sızmamalı, sorular yalnız bankadan gelmeli.
 */
async function setup(seed: Tables = {}, options: FakeSupabaseOptions = {}) {
  const fake = createFakeSupabase(seed, {
    rpc: { web_quiz_record_attempt: { data: null } },
    ...options,
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { webQuizService } = await import('../../src/services/web-quiz.service.js');
  return { fake, service: webQuizService };
}

const NOW = new Date('2026-09-06T12:00:00Z');

const bank = (id: string, locale = 'tr', over: Record<string, unknown> = {}) => ({
  id, locale, is_active: true, selected_count: 1,
  question_text: `Soru ${id}?`, answers: ['A', 'B', 'C', 'D'], ...over,
});
const BANK_IDS = ['q1', 'q2', 'q3', 'q4', 'q5'];
const items = (correct = 1) => BANK_IDS.map((bank_id) => ({ bank_id, correct }));
const createInput = (over: Record<string, unknown> = {}) => ({
  locale: 'tr' as const, nickname: 'Ada', age_confirmed: true as const, items: items(), ...over,
});

const quizRow = (over: Record<string, unknown> = {}) => ({
  id: 'wq1', slug: 'ABCD2345', locale: 'tr', nickname: 'Ada', plays: 3, is_active: true,
  expires_at: '2026-10-01T00:00:00.000Z',
  questions: BANK_IDS.map((bank_id, i) => ({
    bank_id, question_text: `Soru ${bank_id}?`, answers: ['A', 'B', 'C', 'D'], correct: i % 4,
  })),
  ...over,
});

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('getBankSample', () => {
  it('yalnızca istenen dilin aktif sorularından 12 tanesini, cevap anahtarı olmadan döner', async () => {
    const rows = [
      ...Array.from({ length: 15 }, (_, i) => bank(`tr${i}`, 'tr')),
      ...Array.from({ length: 3 }, (_, i) => bank(`en${i}`, 'en')),
      bank('pasif', 'tr', { is_active: false }),
    ];
    const { service } = await setup({ ai_question_bank: rows });

    const sample = await service.getBankSample('tr');

    expect(sample).toHaveLength(12);
    expect(sample.every((q) => q.id.startsWith('tr'))).toBe(true);
    expect(sample.find((q) => q.id === 'pasif')).toBeUndefined();
    expect(Object.keys(sample[0]).sort()).toEqual(['answers', 'id', 'question_text']);
  });
});

describe('create', () => {
  it('bankadan soruları dondurup 8 karakterli CSPRNG slug ile kaydeder', async () => {
    const { fake, service } = await setup({ ai_question_bank: BANK_IDS.map((id) => bank(id)) });

    const { slug } = await service.create(createInput({ items: items(2) }), '203.0.113.7');

    expect(slug).toHaveLength(8);
    for (const ch of slug) expect(SHORT_CODE_ALPHABET).toContain(ch);
    const [row] = fake.table('web_quizzes');
    expect(row.slug).toBe(slug);
    expect(row.nickname).toBe('Ada');
    expect(row.questions).toHaveLength(5);
    expect(row.questions[0]).toEqual({
      bank_id: 'q1', question_text: 'Soru q1?', answers: ['A', 'B', 'C', 'D'], correct: 2,
    });
    // 30 gün TTL; ham IP değil HMAC takma-adı
    expect(row.expires_at).toBe('2026-10-06T12:00:00.000Z');
    expect(row.creator_ip_hash).toBe(hashIp('203.0.113.7'));
    expect(row.creator_ip_hash).not.toContain('203.0.113.7');
    expect(row.creator_ip_hash).toHaveLength(32);
  });

  it('bankada olmayan soru id ile reddeder', async () => {
    const { fake, service } = await setup({ ai_question_bank: BANK_IDS.slice(0, 4).map((id) => bank(id)) });

    await expect(service.create(createInput(), '1.1.1.1')).rejects.toMatchObject({ code: 'WEB_QUIZ_BAD_QUESTIONS' });
    expect(fake.table('web_quizzes')).toHaveLength(0);
  });

  it('testin dilinden farklı dildeki soruyu reddeder', async () => {
    const rows = BANK_IDS.map((id) => bank(id));
    rows[4] = bank('q5', 'en');
    const { service } = await setup({ ai_question_bank: rows });

    await expect(service.create(createInput(), '1.1.1.1')).rejects.toMatchObject({ code: 'WEB_QUIZ_BAD_QUESTIONS' });
  });

  it('pasif soruyu reddeder', async () => {
    const rows = BANK_IDS.map((id) => bank(id));
    rows[0] = bank('q1', 'tr', { is_active: false });
    const { service } = await setup({ ai_question_bank: rows });

    await expect(service.create(createInput(), '1.1.1.1')).rejects.toMatchObject({ code: 'WEB_QUIZ_BAD_QUESTIONS' });
  });

  it('benzersizlik dışı yazma hatasında SERVER_ERROR fırlatır', async () => {
    const { fake, service } = await setup(
      { ai_question_bank: BANK_IDS.map((id) => bank(id)) },
      { failOn: [{ table: 'web_quizzes', op: 'insert', error: { message: 'boom', code: '42P01' } }] },
    );

    await expect(service.create(createInput(), '1.1.1.1')).rejects.toMatchObject({ code: 'SERVER_ERROR', statusCode: 500 });
    expect(fake.table('web_quizzes')).toHaveLength(0);
  });

  it('slug çakışmasında (23505) yeni slug ile 5 kez dener, sonra vazgeçer', async () => {
    const { service } = await setup(
      { ai_question_bank: BANK_IDS.map((id) => bank(id)) },
      { failOn: [{ table: 'web_quizzes', op: 'insert', error: { message: 'duplicate', code: '23505' } }] },
    );
    const spy = vi.spyOn(service, 'generateSlug');

    await expect(service.create(createInput(), '1.1.1.1')).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(spy).toHaveBeenCalledTimes(5);
    expect(new Set(spy.mock.results.map((r) => r.value)).size).toBe(5);
  });
});

describe('getPublic', () => {
  it('doğru cevabı dışarı vermez', async () => {
    const { service } = await setup({ web_quizzes: [quizRow()] });

    const quiz = await service.getPublic('abcd2345'); // küçük harf de kabul

    expect(quiz.slug).toBe('ABCD2345');
    expect(quiz.nickname).toBe('Ada');
    expect(quiz.questions).toHaveLength(5);
    for (const q of quiz.questions) {
      expect(q).not.toHaveProperty('correct');
      expect(q).not.toHaveProperty('bank_id');
    }
    expect(quiz).not.toHaveProperty('id');
  });

  it('bilinmeyen slug 404', async () => {
    const { service } = await setup({ web_quizzes: [quizRow()] });
    await expect(service.getPublic('ZZZZ9999')).rejects.toMatchObject({ code: 'WEB_QUIZ_NOT_FOUND', statusCode: 404 });
  });

  it('süresi dolmuş test 404', async () => {
    const { service } = await setup({ web_quizzes: [quizRow({ expires_at: '2026-09-01T00:00:00.000Z' })] });
    await expect(service.getPublic('ABCD2345')).rejects.toMatchObject({ code: 'WEB_QUIZ_NOT_FOUND' });
  });

  it('moderasyonla kapatılmış (is_active=false) test 404', async () => {
    const { service } = await setup({ web_quizzes: [quizRow({ is_active: false })] });
    await expect(service.getPublic('ABCD2345')).rejects.toMatchObject({ code: 'WEB_QUIZ_NOT_FOUND' });
  });
});

describe('attempt', () => {
  it('skoru sayar, doğru cevapları açıklar, oynanışı tek RPC ile kaydeder', async () => {
    const { fake, service } = await setup({ web_quizzes: [quizRow()] });
    // correct = [0,1,2,3,0]; verilen = [0,1,0,0,0] → 3 doğru
    const result = await service.attempt('ABCD2345', [0, 1, 0, 0, 0]);

    expect(result).toMatchObject({ nickname: 'Ada', score: 3, total: 5 });
    expect(result.results.map((r) => r.is_correct)).toEqual([true, true, false, false, true]);
    expect(result.results[2]).toEqual({ chosen: 0, correct: 2, is_correct: false });

    expect(fake.rpcCalls).toEqual([
      { name: 'web_quiz_record_attempt', args: { p_quiz_id: 'wq1', p_score: 3, p_total: 5, p_answers: [0, 1, 0, 0, 0] } },
    ]);
  });

  it('istatistik yazımı patlasa da skor döner (bloklamaz), hata loglanır', async () => {
    const { service } = await setup(
      { web_quizzes: [quizRow()] },
      { rpc: { web_quiz_record_attempt: { error: { message: 'rpc down' } } } },
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await service.attempt('ABCD2345', [0, 1, 2, 3, 0]);

    expect(result.score).toBe(5);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[web-quiz]'), 'rpc down');
  });

  it('süresi dolmuş teste oynanış kabul etmez', async () => {
    const { fake, service } = await setup({ web_quizzes: [quizRow({ expires_at: '2026-09-01T00:00:00.000Z' })] });
    await expect(service.attempt('ABCD2345', [0, 0, 0, 0, 0])).rejects.toMatchObject({ code: 'WEB_QUIZ_NOT_FOUND' });
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it('cevap sayısı soru sayısıyla uyuşmazsa VALIDATION_ERROR', async () => {
    const { service } = await setup({ web_quizzes: [quizRow()] });
    await expect(service.attempt('ABCD2345', [0, 1])).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('purgeExpired', () => {
  it('süresi 1 günden uzun süre önce dolanları siler, yenileri bırakır', async () => {
    const { fake, service } = await setup({
      web_quizzes: [
        quizRow({ id: 'old', slug: 'AAAA2222', expires_at: '2026-09-01T00:00:00.000Z' }),
        quizRow({ id: 'grace', slug: 'BBBB3333', expires_at: '2026-09-05T18:00:00.000Z' }), // 18 saat önce — bekler
        quizRow({ id: 'live', slug: 'CCCC4444' }),
      ],
    });

    const removed = await service.purgeExpired();

    expect(removed).toBe(1);
    expect(fake.table('web_quizzes').map((r) => r.id).sort()).toEqual(['grace', 'live']);
  });
});
