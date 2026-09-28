import { describe, it, expect } from 'vitest';
import { passesFrequency } from '../../src/services/page-message.service.js';

/**
 * Frekans kurallari switch'ten tabloya tasindi (2026-09-28 review, Open/Closed). Duz nesne tablosu
 * `"constructor"`, `"toString"` gibi degerlerde prototipten fonksiyon bulup mesaji gosterirdi;
 * bilinmeyen deger switch'in `default`u gibi her zaman `false` olmali. Dort bilinen kural
 * `src/__tests__/page-message.frequency.test.ts`'te.
 */
describe('passesFrequency — bilinmeyen deger', () => {
  it('bilinmeyen ve prototip adli frekans degerleri gosterilmez', () => {
    for (const frekans of ['weekly', '', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(passesFrequency(frekans, [])).toBe(false);
    }
  });

  it('bilinen kurallar yerinde: every_visit her zaman, once gosterildiyse bir daha degil', () => {
    expect(passesFrequency('every_visit', [{ event: 'shown', created_at: '2026-09-28T00:00:00Z' }])).toBe(true);
    expect(passesFrequency('once', [])).toBe(true);
    expect(passesFrequency('once', [{ event: 'shown', created_at: '2026-09-28T00:00:00Z' }])).toBe(false);
  });
});
