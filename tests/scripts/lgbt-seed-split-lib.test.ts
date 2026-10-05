import { describe, it, expect } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';
import { mentionsGender, selectSeedsForSplit, applySplit, loadSeedCandidates, type SeedCandidate } from '../../scripts/seed/lgbt-seed-split-lib.js';

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
      { id: 'm1', is_seed_profile: true, gender_pref: 'WOMAN' }, { id: 'm2', is_seed_profile: true, gender_pref: 'WOMAN' },
      { id: 'w1', is_seed_profile: true, gender_pref: 'MAN' },
    ] });
    const r = await applySplit(fake.client as never, { men: [c('m1')], women: [c('w1', { gender: 'WOMAN', gender_pref: 'MAN' })], alreadyMen: 0, alreadyWomen: 0 });
    expect(r).toEqual({ men: 1, women: 1 });
    expect(fake.table('users').map((u) => [u.id, u.gender_pref])).toEqual([['m1', 'MAN'], ['m2', 'WOMAN'], ['w1', 'WOMAN']]);
  });

  it('bayat seçim: seed olmayan ya da tercihi değişmiş satırı ezmez', async () => {
    const fake = createFakeSupabase({ users: [
      { id: 'real', is_seed_profile: false, gender_pref: 'WOMAN' },
      { id: 'changed', is_seed_profile: true, gender_pref: 'BOTH' },
      { id: 'ok', is_seed_profile: true, gender_pref: 'WOMAN' },
    ] });
    const r = await applySplit(fake.client as never, { men: [c('real'), c('changed'), c('ok')], women: [], alreadyMen: 0, alreadyWomen: 0 });
    expect(r).toEqual({ men: 1, women: 0 });
    expect(fake.table('users').map((u) => [u.id, u.gender_pref])).toEqual([['real', 'WOMAN'], ['changed', 'BOTH'], ['ok', 'MAN']]);
  });
});

describe('loadSeedCandidates', () => {
  const pad = (n: number) => String(n).padStart(4, '0');
  const seedId = (n: number) => `s${pad(n)}`;
  const seedRow = (n: number, over: Record<string, unknown> = {}) => ({
    id: seedId(n), gender: 'MAN', gender_pref: 'WOMAN', age: 28, city: 'Ankara', bio: 'Kahve ve kitap',
    is_seed_profile: true, is_deleted: false, ...over,
  });
  // 120 seed → .in() için 2 parça (100 + 20).
  const seeds = Array.from({ length: 120 }, (_, i) => seedRow(i));
  const byId = (cands: SeedCandidate[], id: string) => cands.find((x) => x.id === id)!;

  it('ikinci parçadaki seed\'in gerçek-kullanıcı beğenisi, eşleşmesi ve soru metni toplanır; seed→seed beğeni yok sayılır', async () => {
    const fake = createFakeSupabase({
      users: [...seeds, seedRow(900, { is_seed_profile: false }), seedRow(901, { is_deleted: true }), seedRow(902, { gender: 'OTHER' })],
      swipes: [
        { id: 'a1', swiper_id: 'real-1', target_id: seedId(110), action: 'LIKE' },
        { id: 'a2', swiper_id: seedId(7), target_id: seedId(5), action: 'LIKE' },
        { id: 'a3', swiper_id: 'real-2', target_id: seedId(6), action: 'PASS' },
      ],
      matches: [
        { id: 'm1', user1_id: 'real-1', user2_id: seedId(50) },
        { id: 'm2', user1_id: seedId(115), user2_id: 'real-3' },
      ],
      questions: [
        { id: 'q1', user_id: seedId(2), question_text: 'Kadınlar hakkında ne düşünürsün?', answer_1: 'A', answer_2: 'B', answer_3: null, answer_4: 'D' },
        { id: 'q2', user_id: seedId(119), question_text: 'Favori renk?', answer_1: 'Mavi', answer_2: 'Kırmızı', answer_3: 'Yeşil', answer_4: 'Sarı' },
        { id: 'q3', user_id: 'real-1', question_text: 'Yabancı', answer_1: 'x', answer_2: 'y', answer_3: 'z', answer_4: 'w' },
      ],
    });
    const cands = await loadSeedCandidates(fake.client as never);
    expect(cands).toHaveLength(120); // seed olmayan, silinmiş ve cinsiyeti MAN/WOMAN olmayan elendi
    expect(byId(cands, seedId(110)).hasIncomingLike).toBe(true);
    expect(byId(cands, seedId(5)).hasIncomingLike).toBe(false); // seed→seed
    expect(byId(cands, seedId(6)).hasIncomingLike).toBe(false); // PASS
    expect(byId(cands, seedId(50)).hasMatch).toBe(true);        // user2_id
    expect(byId(cands, seedId(115)).hasMatch).toBe(true);       // user1_id, ikinci parça
    expect(byId(cands, seedId(1)).hasMatch).toBe(false);
    expect(byId(cands, seedId(2)).texts).toEqual(['Kahve ve kitap', 'Kadınlar hakkında ne düşünürsün?', 'A', 'B', 'D']);
    expect(byId(cands, seedId(119)).texts).toEqual(['Kahve ve kitap', 'Favori renk?', 'Mavi', 'Kırmızı', 'Yeşil', 'Sarı']);
    // Sonuç seçiciyle birleşince: beğenisi/eşleşmesi/cinsiyet atfı olanlar dışarıda.
    const picked = selectSeedsForSplit(cands, { men: 120, women: 0 }).men.map((x) => x.id);
    for (const out of [seedId(110), seedId(50), seedId(115), seedId(2)]) expect(picked).not.toContain(out);
    expect(picked).toContain(seedId(5));
  });

  it('1000 satır sınırını aşan okumalar sayfalanır: sondaki gerçek beğeni/eşleşme/soru kaçmaz', async () => {
    const many = (n: number, mk: (i: number) => Record<string, unknown>) => Array.from({ length: n }, (_, i) => mk(i));
    const fake = createFakeSupabase({
      users: seeds,
      // 1100 seed→seed LIKE (yok sayılır) + id sırasında EN SONDA gerçek kullanıcı beğenisi.
      swipes: [
        ...many(1100, (i) => ({ id: `a${pad(i)}`, swiper_id: seedId(10), target_id: seedId(0), action: 'LIKE' })),
        { id: 'zz', swiper_id: 'real-1', target_id: seedId(1), action: 'LIKE' },
      ],
      matches: [
        ...many(1100, (i) => ({ id: `a${pad(i)}`, user1_id: seedId(4), user2_id: `real-${i}` })),
        { id: 'zz', user1_id: seedId(6), user2_id: 'real-x' },
      ],
      questions: [
        ...many(1100, (i) => ({ id: `a${pad(i)}`, user_id: seedId(3), question_text: 'Soru', answer_1: 'a', answer_2: 'b', answer_3: 'c', answer_4: 'd' })),
        { id: 'zz', user_id: seedId(8), question_text: 'Kızlar mı erkekler mi?', answer_1: 'a', answer_2: 'b', answer_3: 'c', answer_4: 'd' },
      ],
    }, { maxRows: 1000 });
    const cands = await loadSeedCandidates(fake.client as never);
    expect(byId(cands, seedId(1)).hasIncomingLike).toBe(true);
    expect(byId(cands, seedId(0)).hasIncomingLike).toBe(false);
    expect(byId(cands, seedId(4)).hasMatch).toBe(true);
    expect(byId(cands, seedId(6)).hasMatch).toBe(true);
    expect(byId(cands, seedId(3)).texts).toHaveLength(1 + 1100 * 5);
    expect(byId(cands, seedId(8)).texts).toContain('Kızlar mı erkekler mi?');
  });

  it('okuma hatasında fırlatır (sessiz boş sonuç yok)', async () => {
    const fake = createFakeSupabase({ users: seeds }, { failOn: [{ table: 'swipes', op: 'select', error: { message: 'boom' } }] } as never);
    await expect(loadSeedCandidates(fake.client as never)).rejects.toThrow(/aday okuma: boom/);
  });
});
