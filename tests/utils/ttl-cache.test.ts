import { describe, it, expect, vi } from 'vitest';
import { TtlCache } from '../../src/utils/ttl-cache.js';

function saat(baslangic = 1_000) {
  let t = baslangic;
  return { simdi: () => t, ileri: (ms: number) => { t += ms; } };
}

describe('TtlCache', () => {
  it('TTL dolana kadar degeri doner, dolunca undefined', () => {
    const s = saat();
    const c = new TtlCache<string, boolean>(60_000, 10, s.simdi);
    c.set('u1', true);
    s.ileri(59_999);
    expect(c.get('u1')).toBe(true);
    s.ileri(1);
    expect(c.get('u1')).toBeUndefined();
  });

  it('false degeri de onbellekte tutulur (yok ile karistirilmaz)', () => {
    const c = new TtlCache<string, boolean>(60_000);
    c.set('u1', false);
    expect(c.get('u1')).toBe(false);
  });

  it('delete ve clear kaydi hemen dusurur', () => {
    const c = new TtlCache<string, number>(60_000);
    c.set('a', 1);
    c.set('b', 2);
    c.delete('a');
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe(2);
    c.clear();
    expect(c.get('b')).toBeUndefined();
  });

  it('set TTL suresini yeniler', () => {
    const s = saat();
    const c = new TtlCache<string, number>(1_000, 10, s.simdi);
    c.set('a', 1);
    s.ileri(900);
    c.set('a', 2);
    s.ileri(900);
    expect(c.get('a')).toBe(2);
  });

  it('boyut siniri: once suresi dolanlari, sonra en eski kaydi atar', () => {
    const s = saat();
    const c = new TtlCache<string, number>(1_000, 2, s.simdi);
    c.set('eski', 1);
    s.ileri(1_000); // 'eski' doldu
    c.set('b', 2);
    c.set('c', 3); // dolu: 'eski' suresi dolmus -> o atilir
    expect(c.size).toBe(2);
    expect(c.get('b')).toBe(2);
    c.set('d', 4); // dolu ve dolmus kayit yok -> en eski eklenen ('b') atilir
    expect(c.size).toBe(2);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('c')).toBe(3);
    expect(c.get('d')).toBe(4);
  });

  it('getOrLoad: onbellekte varsa yukleyici cagrilmaz; yoksa bir kez cagrilir ve yazilir', async () => {
    const c = new TtlCache<string, number>(60_000);
    const yukle = vi.fn(async () => 7);
    expect(await c.getOrLoad('a', yukle)).toBe(7);
    expect(await c.getOrLoad('a', yukle)).toBe(7);
    expect(yukle).toHaveBeenCalledTimes(1);
  });

  it('getOrLoad: undefined sonuc ve firlatilan hata yazilmaz', async () => {
    const c = new TtlCache<string, number>(60_000);
    expect(await c.getOrLoad('a', async () => undefined)).toBeUndefined();
    await expect(c.getOrLoad('a', async () => { throw new Error('db'); })).rejects.toThrow('db');
    expect(c.size).toBe(0);
  });

  it('getOrLoad: okuma surerken delete/clear gelirse eski sonuc YAZILMAZ (yaris)', async () => {
    // Ban aninda: okuma yazimdan once basladi, cevabi temizlikten sonra geldi. Eskiden bu
    // eski "banli degil" degeri 60 sn geri yaziliyordu (2026-09-28 review, yeniden uretildi).
    const temizlikler = [
      (c: TtlCache<string, boolean>) => c.delete('u1'),
      (c: TtlCache<string, boolean>) => c.clear(),
    ];
    for (const temizle of temizlikler) {
      const c = new TtlCache<string, boolean>(60_000);
      let ac: (v: boolean) => void = () => undefined;
      const okuma = c.getOrLoad('u1', () => new Promise<boolean>((r) => { ac = r; }));
      temizle(c);
      ac(false);
      expect(await okuma).toBe(false);
      expect(c.get('u1')).toBeUndefined();
    }
  });

  it('var olan anahtari guncellemek yer acmak icin baska kaydi atmaz', () => {
    const c = new TtlCache<string, number>(60_000, 2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('a', 3);
    expect(c.get('a')).toBe(3);
    expect(c.get('b')).toBe(2);
  });
});
