import { describe, it, expect, afterEach, vi } from 'vitest';
import { aiSuggestService } from '../services/ai-suggest.service.js';

// scoreAndPick private — TS'de private sadece derleme zamanı, runtime'da erişilebilir.
// Production kodunu değiştirmeden gerçek implementasyonu test ediyoruz.
const scoreAndPick = (questions: unknown[], count: number) =>
  (aiSuggestService as unknown as {
    scoreAndPick: (q: unknown[], c: number) => Array<Record<string, unknown>>;
  }).scoreAndPick(questions, count);

/** Sadece scoreAndPick'in okuduğu alanlar — gerisi taşıma yükü. */
function q(id: string, selected: number, shown: number) {
  return { id, selected_count: selected, shown_count: shown, question_text: id };
}

/** scoreAndPick içindeki shuffle Math.random kullanıyor → deterministik hale getir. */
function freezeRandom(value = 0.5) {
  vi.spyOn(Math, 'random').mockReturnValue(value);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AiSuggestService.scoreAndPick', () => {
  describe('skor formülü — Laplace smoothing (selected+1)/(shown+2)', () => {
    it('hiç gösterilmemiş soru 0.5 alır (nötr başlangıç)', () => {
      freezeRandom();
      const [only] = scoreAndPick([q('new', 0, 0)], 1);
      expect(only.score).toBe(0.5);
    });

    it('yüksek seçilme oranı daha yüksek skor verir', () => {
      freezeRandom();
      const result = scoreAndPick([q('popular', 80, 100), q('unpopular', 5, 100)], 2);
      const byId = Object.fromEntries(result.map((r) => [r.id, r.score as number]));
      expect(byId.popular).toBeGreaterThan(byId.unpopular);
    });

    it('skor her zaman 0 ile 1 arasında', () => {
      freezeRandom();
      const cases = [q('a', 0, 0), q('b', 0, 1000), q('c', 1000, 1000), q('d', 50, 100)];
      for (const scored of scoreAndPick(cases, cases.length)) {
        expect(scored.score as number).toBeGreaterThanOrEqual(0);
        expect(scored.score as number).toBeLessThanOrEqual(1);
      }
    });

    it('az gösterilmiş soru, çok gösterilip az seçilenden öne geçer (keşif yanlılığı)', () => {
      freezeRandom();
      const result = scoreAndPick([q('stale', 5, 500), q('fresh', 0, 0)], 2);
      const byId = Object.fromEntries(result.map((r) => [r.id, r.score as number]));
      expect(byId.fresh).toBeGreaterThan(byId.stale);
    });
  });

  describe('seçim davranışı', () => {
    it('istenen adetten fazla döndürmez', () => {
      freezeRandom();
      const pool = Array.from({ length: 50 }, (_, i) => q(`q${i}`, i, 100));
      expect(scoreAndPick(pool, 5)).toHaveLength(5);
    });

    it('havuz istenen adetten küçükse hepsini döndürür', () => {
      freezeRandom();
      expect(scoreAndPick([q('a', 1, 1), q('b', 2, 2)], 5)).toHaveLength(2);
    });

    it('boş havuz boş döner', () => {
      freezeRandom();
      expect(scoreAndPick([], 5)).toHaveLength(0);
    });

    it('sadece en iyi skorlu count*3 aday havuzundan seçer', () => {
      freezeRandom();
      // 30 aday, count=3 → havuz ilk 9. Son 21 asla seçilmemeli.
      const pool = Array.from({ length: 30 }, (_, i) => q(`q${i}`, 30 - i, 30));
      const picked = scoreAndPick(pool, 3).map((r) => r.id as string);
      const eligible = new Set(Array.from({ length: 9 }, (_, i) => `q${i}`));
      for (const id of picked) expect(eligible.has(id)).toBe(true);
    });

    it('aynı soruyu iki kez döndürmez', () => {
      freezeRandom();
      const pool = Array.from({ length: 20 }, (_, i) => q(`q${i}`, i, 50));
      const picked = scoreAndPick(pool, 5).map((r) => r.id);
      expect(new Set(picked).size).toBe(picked.length);
    });

    it('orijinal soru alanlarını korur', () => {
      freezeRandom();
      const [only] = scoreAndPick([q('keep-me', 3, 10)], 1);
      expect(only.id).toBe('keep-me');
      expect(only.question_text).toBe('keep-me');
      expect(only.selected_count).toBe(3);
    });
  });
});
