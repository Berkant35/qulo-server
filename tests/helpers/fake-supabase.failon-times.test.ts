import { describe, it, expect } from 'vitest';
import { createFakeSupabase } from './fake-supabase.js';

/**
 * `FailureSpec.times` (`StorageFailureSpec.times` karşılığı): yalnız N çağrı patlar, sonrası başarılı —
 * "ilk deneme hata, tek yeniden deneme başarılı" dallarını sınamak için (2026-09-28, itfa FK yarışı).
 */
describe('fake-supabase failOn — times', () => {
  it('failAfter + times: yalnız hedeflenen çağrılar patlar, sonrası yazılır', async () => {
    const fake = createFakeSupabase({ t: [] }, {
      failOn: [{ table: 't', op: 'insert', failAfter: 1, times: 1, error: { message: 'fk', code: '23503' } }],
    });
    const insert = (id: string) => fake.client.from('t').insert({ id });

    expect((await insert('a')).error).toBeNull();
    expect((await insert('b')).error).toMatchObject({ code: '23503' });
    expect((await insert('c')).error).toBeNull();
    expect(fake.table('t').map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('times verilmezse eski davranış: failAfter\'dan sonraki her çağrı patlar', async () => {
    const fake = createFakeSupabase({ t: [] }, { failOn: [{ table: 't', op: 'insert', failAfter: 1 }] });
    const insert = (id: string) => fake.client.from('t').insert({ id });

    expect((await insert('a')).error).toBeNull();
    expect((await insert('b')).error).not.toBeNull();
    expect((await insert('c')).error).not.toBeNull();
    expect(fake.table('t').map((r) => r.id)).toEqual(['a']);
  });
});
