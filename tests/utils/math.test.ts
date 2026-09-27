import { describe, it, expect } from 'vitest';
import { pickOracleSuggestion, paidPortion, splitReward } from '../../src/utils/math.js';

/**
 * ORACLE seciminin degismezleri. Gercek `Math.random` ile 100 tekrar: mock yok,
 * dagilimin her noktasi ayni kurallara uymali.
 */
const ALL = ['A', 'B', 'C', 'D'];

describe('pickOracleSuggestion', () => {
  it('dogru dalinda her zaman dogru sikki verir', () => {
    for (let i = 0; i < 100; i++) {
      expect(pickOracleSuggestion(ALL, 'A', ['C', 'D'], true)).toBe('A');
    }
  });

  it('yanlis dalinda elenmis sikki asla onermez', () => {
    for (let i = 0; i < 100; i++) {
      expect(pickOracleSuggestion(ALL, 'A', ['C', 'D'], false)).toBe('B');
    }
  });

  it('eleme yoksa yanlis dalinda herhangi bir yanlis sik gelir, dogru gelmez', () => {
    for (let i = 0; i < 100; i++) {
      expect(['B', 'C', 'D']).toContain(pickOracleSuggestion(ALL, 'A', [], false));
    }
  });

  it('bozuk veri (tum yanlislar elenmis) yanlis dali dogruya yukseltmez', () => {
    for (let i = 0; i < 100; i++) {
      expect(['B', 'C', 'D']).toContain(pickOracleSuggestion(ALL, 'A', ['B', 'C', 'D'], false));
    }
  });

  it('sayisal indekslerle de calisir (quiz)', () => {
    expect(pickOracleSuggestion([1, 2, 3, 4], 2, [3, 4], false)).toBe(1);
  });
});

describe('paidPortion — önce ödenmiş harcanır', () => {
  it.each([
    [10, 0, 0],
    [10, 4, 4],
    [10, 10, 10],
    [10, 25, 10],
    [10, -3, 0],
  ])('amount %i, purplePaid %i → %i', (amount, paid, expected) => {
    expect(paidPortion(amount, paid)).toBe(expected);
  });
});

describe('splitReward — toplam bugünkü formül, ödenmiş payı rainbow', () => {
  it('ödenmiş yoksa hepsi yeşil', () => {
    expect(splitReward(3, 0, 0.3)).toEqual({ green: 3, rainbow: 0 });
  });
  it('hepsi ödenmişse hepsi rainbow', () => {
    expect(splitReward(3, 10, 0.3)).toEqual({ green: 0, rainbow: 3 });
  });
  it('karışık: 120 mor (20 ödenmiş), oran 0,3 → 30 yeşil + 6 rainbow', () => {
    expect(splitReward(36, 20, 0.3)).toEqual({ green: 30, rainbow: 6 });
  });
  it('yuvarlama aşağı: 15 mor oran 0,25 → toplam 3; 5 ödenmiş → 1 rainbow', () => {
    expect(splitReward(3, 5, 0.25)).toEqual({ green: 2, rainbow: 1 });
  });
  it('rainbow toplamı asla geçmez', () => {
    expect(splitReward(2, 10, 0.25)).toEqual({ green: 0, rainbow: 2 });
  });
  it('negatif ödenmiş 0 sayılır', () => {
    expect(splitReward(3, -5, 0.3)).toEqual({ green: 3, rainbow: 0 });
  });
});
