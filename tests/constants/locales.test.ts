import { describe, it, expect } from 'vitest';
import { questionLocale, SUPPORTED_LOCALES } from '../../src/constants/locales.js';

/**
 * `questionLocale` alti ayri cagrı yerinin ortak invaryanti: kesif aday
 * filtresi, kesif kart bilgisi, public profil, quiz soru secimi ve getMe.
 *
 * Bu testler o yerlerin AYNI cevabi almasini donduruyor. Fallback 'tr'den
 * baska bir seye kayarsa istemci "gorunuyorsun" derken kesif tersini uygular,
 * ya da kullaniciya cozemeyecegi bir soru gosterilir — ve ikisi de sessizce
 * olur, cunku her cagri yeri kendi basina dogru gorunmeye devam eder.
 */
describe('questionLocale', () => {
  it('gecerli locale oldugu gibi doner', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(questionLocale(locale)).toBe(locale);
    }
  });

  it('null, undefined ve bos string tr sayilir', () => {
    // Eski satirlarda `locale` NULL; migration oncesi kayitlar boyle.
    expect(questionLocale(null)).toBe('tr');
    expect(questionLocale(undefined)).toBe('tr');
    expect(questionLocale('')).toBe('tr');
  });

  it('string olmayan degerler tr sayilir, patlamaz', () => {
    // Supabase istemcisi generic'siz kuruldugu icin satirlar `any`; bozuk bir
    // satir buraya sayi ya da nesne olarak gelebilir.
    expect(questionLocale(0)).toBe('tr');
    expect(questionLocale(42)).toBe('tr');
    expect(questionLocale({})).toBe('tr');
    expect(questionLocale([])).toBe('tr');
  });

  it('desteklenmeyen bir kod oldugu gibi doner — sessizce tr yapilmaz', () => {
    // Bilincli: bilinmeyen bir dil 'tr' sayilirsa, o soru Turkce okuyanlara
    // gosterilir. Oldugu gibi birakmak onu hicbir dil kumesiyle eslestirmez,
    // yani gorunmez kalir — yanlis kisiye gosterilmesinden iyidir.
    expect(questionLocale('xx')).toBe('xx');
  });
});

describe('SUPPORTED_LOCALES ↔ AI soru bankasi tohumu paritesi', () => {
  // Dil DB'de gecerli ama bankasi yoksa oneri ekrani ve profil kurulum kapisi sessizce bos kalir
  // (ai-suggest.service `.eq('locale', ...)` → []). Yeni dil = yeni questions_<dil>.json.
  it('her desteklenen dil icin src/data/seed/questions_<dil>.json var', async () => {
    const { existsSync } = await import('node:fs');
    const missing = SUPPORTED_LOCALES.filter(
      (l) => !existsSync(new URL(`../../src/data/seed/questions_${l}.json`, import.meta.url)),
    );
    expect(missing).toEqual([]);
  });
});
