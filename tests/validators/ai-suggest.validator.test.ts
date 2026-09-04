import { describe, it, expect } from 'vitest';
import { aiSuggestSchema } from '../../src/validators/ai-suggest.validator.js';

/**
 * Dalin geri kalani locale varsayilanini tr'den en'e tasidi (register, sosyal
 * giris, app-config); bu validator geride kalmisti — tek tr varsayilani buydu.
 * Mobil bu uc noktada locale'i zaten hep acikca gonderiyor (dusuk etki), ama
 * split convention birakmamak icin duzeltildi.
 */
describe('aiSuggestSchema — locale', () => {
  it('locale verilmezse en varsayılır (tr degil)', () => {
    const result = aiSuggestSchema.safeParse({});
    expect(result.success && result.data.locale).toBe('en');
  });

  it('acikca gonderilen locale degismeden kullanilir', () => {
    const result = aiSuggestSchema.safeParse({ locale: 'de' });
    expect(result.success && result.data.locale).toBe('de');
  });
});
