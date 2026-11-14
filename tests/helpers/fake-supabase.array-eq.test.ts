import { describe, it, expect } from 'vitest';
import { createFakeSupabase } from './fake-supabase.js';
import { pgTextArrayLiteral } from '../../src/utils/pg-array.js';

/**
 * `text[]` sütununda `eq` + dizi literali (fotoğraf dizisi CAS'ı, 2026-11-14): Postgres gibi sıra
 * duyarlı, öğe öğe. Fake eskiden `===` ile karşılaştırıyordu → dizi sütununda hiçbir satır eşleşmez,
 * CAS'lı her yazım testte "eşzamanlı değişiklik" gibi görünürdü.
 */
const ZOR = ['https://x/a,b.jpg', 'tırnak"li', 'ters\\bölü', ''];

async function eslesen(photos: string[], filtre: string[]) {
  const fake = createFakeSupabase({ users: [{ id: 'u1', photos }] });
  const { data } = await fake.client.from('users').select('id').eq('photos', pgTextArrayLiteral(filtre));
  return (data ?? []).length;
}

describe('fake-supabase eq — text[] literali', () => {
  it('aynı dizi (virgül, tırnak, ters bölü, boş öğe dahil) eşleşir', async () => {
    expect(await eslesen(ZOR, ZOR)).toBe(1);
  });

  it('sıra farklıysa, öğe eksik/fazlaysa eşleşmez', async () => {
    expect(await eslesen(['a', 'b'], ['b', 'a'])).toBe(0);
    expect(await eslesen(['a', 'b'], ['a'])).toBe(0);
    expect(await eslesen(['a'], ['a', 'b'])).toBe(0);
  });

  it('boş dizi `{}` yalnız boş diziyle eşleşir', async () => {
    expect(await eslesen([], [])).toBe(1);
    expect(await eslesen(['a'], [])).toBe(0);
  });

  it('tırnaksız literal sessizce yanlış eşleşmez: hata', async () => {
    const fake = createFakeSupabase({ users: [{ id: 'u1', photos: ['a'] }] });
    await expect(async () => await fake.client.from('users').select('id').eq('photos', '{a}')).rejects.toThrow(/tırnaklı/);
  });
});
