import { describe, it, expect } from 'vitest';
import { createFakeSupabase } from './fake-supabase.js';

/**
 * PostgREST boş gövdeli PATCH'i (`{}` ya da yalnız `undefined` alanlar — JSON'da düşer) UPDATE'e
 * çevirmez: `SELECT … WHERE false` çalıştırır, sıfır satır döner, hata yok (QueryBuilder.hs
 * `mutatePlanToQuery … null uCols`). Fake eskiden satırı eşleyip döndürüyordu → mobil fotoğraf
 * sıralamasının canlıdaki 404'ü testte görünmüyordu (2026-11-14).
 */
describe('fake-supabase update — boş gövde', () => {
  it.each([
    ['{}', {}],
    ['yalnız undefined alan', { name: undefined }],
  ])('%s: sıfır satır, hata yok, satır değişmez', async (_ad, patch) => {
    const fake = createFakeSupabase({ users: [{ id: 'u1', name: 'A' }] });
    const r = await fake.client.from('users').update(patch).eq('id', 'u1').select('id').maybeSingle();
    expect(r.error).toBeNull();
    expect(r.data).toBeNull();
    expect(fake.table('users')[0]).toEqual({ id: 'u1', name: 'A' });
  });

  it('dolu gövde eskisi gibi yazar ve satırı döndürür', async () => {
    const fake = createFakeSupabase({ users: [{ id: 'u1', name: 'A' }] });
    const r = await fake.client.from('users').update({ name: 'B', bio: undefined }).eq('id', 'u1').select('id, name').maybeSingle();
    expect(r.data).toMatchObject({ id: 'u1', name: 'B' });
  });
});
