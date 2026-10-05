import { describe, it, expect } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';
import { mentionsGender, selectSeedsForSplit, applySplit, type SeedCandidate } from '../../scripts/seed/lgbt-seed-split-lib.js';

const c = (id: string, over: Partial<SeedCandidate> = {}): SeedCandidate => ({
  id, gender: 'MAN', gender_pref: 'WOMAN', age: 28, city: 'İstanbul', texts: ['Kahve ve kitap'],
  hasMatch: false, hasIncomingLike: false, ...over,
});

describe('mentionsGender', () => {
  const table: Array<[string, boolean]> = [
    ['Kadınlar hakkında konuşalım', true],
    ['İdeal kızım nasıl biri?', true],
    ['Bir kız arkadaşım var', true],
    ['Erkekler neden böyle?', true],
    ['Beyaz kahve severim', false],
    ['Manzara fotoğrafı çekerim', false],
    ['Looking for a girlfriend', true],
    ['Bey efendi gibi davranırım', true],
    ['Hafta sonu kamp', false],
  ];
  for (const [text, expected] of table) {
    it(`"${text}" → ${expected}`, () => expect(mentionsGender(text)).toBe(expected));
  }
});

describe('selectSeedsForSplit', () => {
  it('eşleşmesi, gelen beğenisi ya da cinsiyet atfı olan seed seçilmez', () => {
    const sel = selectSeedsForSplit([
      c('m1', { hasMatch: true }),
      c('m2', { hasIncomingLike: true }),
      c('m3', { texts: ['Kadınlara saygım sonsuz'] }),
      c('m4'),
    ], { men: 5, women: 0 });
    expect(sel.men.map((s) => s.id)).toEqual(['m4']);
  });

  it('hedef sayıyı aşmaz; kadınlar WOMAN tercihine ayrılır', () => {
    const women = Array.from({ length: 5 }, (_, i) => c(`w${i}`, { gender: 'WOMAN', gender_pref: 'MAN' }));
    const sel = selectSeedsForSplit(women, { men: 0, women: 3 });
    expect(sel.women).toHaveLength(3);
  });

  it('idempotent: zaten ayrılmışlar hedeften düşülür', () => {
    const sel = selectSeedsForSplit([
      c('done1', { gender_pref: 'MAN' }), c('done2', { gender_pref: 'MAN' }), c('m1'), c('m2'),
    ], { men: 3, women: 0 });
    expect(sel.men.map((s) => s.id)).toEqual(['m1']);
    expect(sel.alreadyMen).toBe(2);
  });

  it('şehir × yaş grupları arasında sırayla seçer (tek şehre yığılmaz) ve deterministik', () => {
    const cands = [
      c('a1', { city: 'Ankara' }), c('a2', { city: 'Ankara' }), c('a3', { city: 'Ankara' }),
      c('i1', { city: 'İzmir' }), c('i2', { city: 'İzmir' }),
    ];
    const first = selectSeedsForSplit(cands, { men: 4, women: 0 }).men.map((s) => s.id);
    expect(first).toEqual(['a1', 'i1', 'a2', 'i2']);
    expect(selectSeedsForSplit([...cands].reverse(), { men: 4, women: 0 }).men.map((s) => s.id)).toEqual(first);
  });
});

describe('applySplit', () => {
  it('yalnız seçilen seed\'lerin tercihini yazar', async () => {
    const fake = createFakeSupabase({ users: [
      { id: 'm1', gender_pref: 'WOMAN' }, { id: 'm2', gender_pref: 'WOMAN' }, { id: 'w1', gender_pref: 'MAN' },
    ] });
    const r = await applySplit(fake.client as never, { men: [c('m1')], women: [c('w1', { gender: 'WOMAN', gender_pref: 'MAN' })], alreadyMen: 0, alreadyWomen: 0 });
    expect(r).toEqual({ men: 1, women: 1 });
    expect(fake.table('users').map((u) => [u.id, u.gender_pref])).toEqual([['m1', 'MAN'], ['m2', 'WOMAN'], ['w1', 'WOMAN']]);
  });
});
