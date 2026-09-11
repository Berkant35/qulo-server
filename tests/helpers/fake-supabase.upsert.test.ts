import { describe, it, expect } from 'vitest';
import { createFakeSupabase } from './fake-supabase.js';

/**
 * Fake'in yazma semantiği gerçek PostgREST/Postgres'e sadık olmalı — değilse testler
 * prod'da olmayan bir davranışı yeşil (ya da kırmızı) gösterir.
 *
 * İki açık kapatıldı (2026-09-11, consent meta işi):
 * - Bileşik `onConflict` ("a,b") tek kolon adı sanılıyordu → upsert her seferinde
 *   yeni satır ekliyordu; prod güncellerdi.
 * - `undefined` alan mevcut değeri eziyordu; PostgREST onu hiç göndermez, değer kalır.
 */
describe('fake-supabase upsert — bileşik onConflict', () => {
  it('tüm anahtar parçaları eşleşirse mevcut satırı günceller', async () => {
    const fake = createFakeSupabase({ t: [{ id: 1, a: 'x', b: 'y', v: 1 }] });

    await fake.client.from('t').upsert({ a: 'x', b: 'y', v: 2 }, { onConflict: 'a,b' });

    expect(fake.table('t')).toEqual([{ id: 1, a: 'x', b: 'y', v: 2 }]);
  });

  it('bir parça farklıysa yeni satır ekler', async () => {
    const fake = createFakeSupabase({ t: [{ id: 1, a: 'x', b: 'y', v: 1 }] });

    await fake.client.from('t').upsert({ a: 'x', b: 'z', v: 2 }, { onConflict: 'a,b' });

    expect(fake.table('t')).toHaveLength(2);
    expect(fake.table('t')[0].v).toBe(1);
  });

  it('anahtar parçası NULL ise çakışma sayılmaz (Postgres NULLS DISTINCT)', async () => {
    const fake = createFakeSupabase({ t: [{ id: 1, a: 'x', b: null, v: 1 }] });

    await fake.client.from('t').upsert({ a: 'x', b: null, v: 2 }, { onConflict: 'a,b' });

    expect(fake.table('t')).toHaveLength(2);
  });

  it('tek kolonlu onConflict eskisi gibi çalışır', async () => {
    const fake = createFakeSupabase({ t: [{ id: 1, a: 'x', v: 1 }] });

    await fake.client.from('t').upsert({ a: 'x', v: 2 }, { onConflict: 'a' });

    expect(fake.table('t')).toEqual([{ id: 1, a: 'x', v: 2 }]);
  });
});

describe('fake-supabase — undefined alan mevcut değeri silmez', () => {
  it('upsert güncellemesinde', async () => {
    const fake = createFakeSupabase({ t: [{ id: 1, a: 'x', v: 1, keep: 'k' }] });

    await fake.client.from('t').upsert({ a: 'x', v: 2, keep: undefined }, { onConflict: 'a' });

    expect(fake.table('t')[0]).toEqual({ id: 1, a: 'x', v: 2, keep: 'k' });
  });

  it('update\'te', async () => {
    const fake = createFakeSupabase({ t: [{ id: 1, v: 1, keep: 'k' }] });

    await fake.client.from('t').update({ v: 2, keep: undefined }).eq('id', 1);

    expect(fake.table('t')[0]).toEqual({ id: 1, v: 2, keep: 'k' });
  });

  it('null ise yine yazar — açıkça temizlemek geçerli bir işlem', async () => {
    const fake = createFakeSupabase({ t: [{ id: 1, keep: 'k' }] });

    await fake.client.from('t').update({ keep: null }).eq('id', 1);

    expect(fake.table('t')[0].keep).toBeNull();
  });
});
