import { describe, it, expect } from 'vitest';
import { pickOracleSuggestion } from '../../src/utils/math.js';

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
