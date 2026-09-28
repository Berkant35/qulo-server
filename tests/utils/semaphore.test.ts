import { describe, it, expect } from 'vitest';
import { Semafor } from '../../src/utils/semaphore.js';

/** Elle bitirilen is: `bitir()` cagrilana kadar surer. */
function elleIs() {
  let bitir: () => void = () => undefined;
  const bitti = new Promise<void>((r) => { bitir = r; });
  return { bitti, bitir: () => bitir() };
}

const tik = () => new Promise((r) => setTimeout(r, 0));

describe('Semafor', () => {
  it('ayni anda en fazla limit kadar is calisir; fazlasi sirayla (FIFO) baslar', async () => {
    const s = new Semafor(2);
    const isler = [elleIs(), elleIs(), elleIs(), elleIs()];
    const baslayan: number[] = [];
    let esZamanli = 0;
    let enFazla = 0;
    const sozler = isler.map((is, i) => s.calistir(async () => {
      baslayan.push(i);
      esZamanli++; enFazla = Math.max(enFazla, esZamanli);
      await is.bitti;
      esZamanli--;
      return i;
    }));

    await tik();
    expect(baslayan).toEqual([0, 1]);
    isler[1].bitir();
    await tik();
    expect(baslayan).toEqual([0, 1, 2]);
    isler[0].bitir(); isler[2].bitir(); isler[3].bitir();

    expect(await Promise.all(sozler)).toEqual([0, 1, 2, 3]);
    expect(enFazla).toBe(2);
  });

  it('yuva devrinde araya giren yeni cagri siniri asamaz', async () => {
    // Pencere: biten isin `finally`si ile uyandirilan bekleyenin devam etmesi arasi. Sayac once
    // dusup bekleyen sonra artirsaydi, bu aralikta gelen cagri bos yuva gorup sinira ekleniyordu.
    // Pencerenin tam derinligi uygulamaya bagli; bu yuzden 1..8 her mikro gorev derinliginde
    // yeni cagri gelir (naif devirde 2. derinlik siniri 2'ye cikariyordu — elle izlendi).
    const s = new Semafor(1);
    const a = elleIs();
    let esZamanli = 0;
    let enFazla = 0;
    const olc = (bekle: Promise<unknown>) => s.calistir(async () => {
      esZamanli++; enFazla = Math.max(enFazla, esZamanli);
      await bekle;
      await Promise.resolve();
      esZamanli--;
    });
    const ilk = olc(a.bitti);
    const ikinci = olc(Promise.resolve());   // kuyrukta bekler
    const arayaGirenler: Promise<void>[] = [];
    for (let derinlik = 1; derinlik <= 8; derinlik++) {
      let zincir: Promise<unknown> = a.bitti;
      for (let i = 1; i < derinlik; i++) zincir = zincir.then(() => undefined);
      void zincir.then(() => { arayaGirenler.push(olc(Promise.resolve())); });
    }
    a.bitir();

    await Promise.all([ilk, ikinci]);
    await tik();
    await Promise.all(arayaGirenler);
    expect(arayaGirenler).toHaveLength(8);
    expect(enFazla).toBe(1);
  });

  it('hata veren is yuvayi birakir ve hatayi cagirana iletir', async () => {
    const s = new Semafor(1);
    await expect(s.calistir(async () => { throw new Error('bozuk'); })).rejects.toThrow('bozuk');
    expect(await s.calistir(async () => 'sonraki')).toBe('sonraki');
  });

  it('gecersiz limit reddedilir', () => {
    expect(() => new Semafor(0)).toThrow();
    expect(() => new Semafor(1.5)).toThrow();
  });
});
