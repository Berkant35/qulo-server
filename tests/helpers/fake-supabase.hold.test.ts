import { describe, it, expect } from 'vitest';
import { createFakeSupabase } from './fake-supabase.js';

/**
 * `holdRead` sadakati: ilk okuma cagri aninin ANLIK GORUNTUSUNU dondurur ama cevabi kapi acilinca
 * teslim eder; arada yapilan yazim o cevaba sizmaz, sonraki okuma bekletilmez ve yazimi gorur.
 * Onbellek dolumu yarislari (TtlCache.getOrLoad) bununla sinaniyor.
 */
describe('fake-supabase holdRead', () => {
  function kapi() {
    let ac: () => void = () => undefined;
    const acildi = new Promise<void>((r) => { ac = r; });
    return { acildi, ac: () => ac() };
  }

  it('ilk okuma cagri anindaki degeri, kapi acilinca teslim eder; sonraki okuma bekletilmez', async () => {
    const k = kapi();
    const fake = createFakeSupabase({ users: [{ id: 'u1', is_banned: false }] }, { holdRead: { table: 'users', until: k.acildi } });

    let teslim = false;
    const ilk = fake.client.from('users').select('is_banned').eq('id', 'u1').maybeSingle()
      .then((r: { data: { is_banned: boolean } }) => { teslim = true; return r; });
    await fake.client.from('users').update({ is_banned: true }).eq('id', 'u1');
    const ikinci = await fake.client.from('users').select('is_banned').eq('id', 'u1').maybeSingle();

    // Fake kolon izdusumu yapmaz (tum satir doner); yalniz ilgili alan karsilastirilir.
    expect(ikinci.data.is_banned).toBe(true);
    await Promise.resolve();
    expect(teslim).toBe(false);

    k.ac();
    expect((await ilk).data.is_banned).toBe(false);
  });

  it('await ile (single/maybeSingle olmadan) okunan zincir de bekletilir; baska tablo etkilenmez', async () => {
    const k = kapi();
    const fake = createFakeSupabase({ a: [{ id: 1 }], b: [{ id: 2 }] }, { holdRead: { table: 'a', until: k.acildi } });

    let teslim = false;
    const ilk = Promise.resolve(fake.client.from('a').select('id')).then((r: { data: unknown[] }) => { teslim = true; return r; });
    const baska = await fake.client.from('b').select('id');

    expect(baska.data).toEqual([{ id: 2 }]);
    await Promise.resolve();
    expect(teslim).toBe(false);
    k.ac();
    expect((await ilk).data).toEqual([{ id: 1 }]);
  });
});
