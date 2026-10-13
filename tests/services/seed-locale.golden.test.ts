import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { GUVENLIK_KORPUSU, personaKartVakalari } from '../helpers/seed-persona-cases.js';

/**
 * TR altin test: locale paketlerine gecis (2026-10-13) TR botunun kartini, guvenlik
 * desenlerini ve cikti denetimini DEGISTIRMEMELI. Beklenen degerler refactor ONCESI koddan
 * uretildi (tests/fixtures/persona-card-tr.golden.json). Kirmiziya donerse once sor:
 * TR metni bilerek mi degisti? Bilerekse altin dosya gerekcesiyle yeniden uretilir.
 */
const ALTIN = JSON.parse(readFileSync(new URL('../fixtures/persona-card-tr.golden.json', import.meta.url), 'utf8')) as {
  kartlar: Record<string, string>;
  guvenlik: Record<string, { kriz: boolean; kapanis: boolean; yasAlti: boolean; guard: string }>;
  ornekKart: string;
};
const sha = (s: string) => createHash('sha1').update(s).digest('hex');

beforeEach(() => vi.resetModules());

async function yukle() {
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: {} }));
  const persona = await import('../../src/services/seed-persona.js');
  const guard = await import('../../src/services/seed-reply-guard.js');
  const svc = await import('../../src/services/seed-reply.service.js');
  const { TR_PAKETI } = await import('../../src/services/seed-locale/index.js');
  return { ...persona, ...guard, svc, TR_PAKETI };
}

describe('TR altin test — persona karti bayt bayt ayni', () => {
  it('ornek kart metni birebir', async () => {
    const { buildPersonaCard } = await yukle();
    expect(buildPersonaCard(personaKartVakalari()[0]![1])).toBe(ALTIN.ornekKart);
  });

  it('146 vakanin hepsi (stil x faz x bayrak x mesafe x isim x olgu)', async () => {
    const { buildPersonaCard } = await yukle();
    const vakalar = personaKartVakalari();
    expect(vakalar.length).toBe(Object.keys(ALTIN.kartlar).length);
    for (const [ad, girdi] of vakalar) {
      expect(sha(buildPersonaCard(girdi)), ad).toBe(ALTIN.kartlar[ad]);
    }
  });

  it("locale 'tr' acikca verilse de, bilinmeyen dil verilse de ayni kart (TR geri donus)", async () => {
    const { buildPersonaCard } = await yukle();
    const girdi = personaKartVakalari()[0]![1];
    expect(buildPersonaCard({ ...girdi, locale: 'tr' })).toBe(ALTIN.ornekKart);
    expect(buildPersonaCard({ ...girdi, locale: 'xx' })).toBe(ALTIN.ornekKart);
    expect(buildPersonaCard({ ...girdi, locale: null })).toBe(ALTIN.ornekKart);
  });
});

/**
 * Altin dosyadan BILINCLI sapmalar (guvenlik incelemesi 2026-10-13): kriz / yas alti kapilari
 * dilden bagimsiz + normalize, giden guard'da telefon/yasak kelime tum paketlerin birlesimi.
 * Yalniz false → true (daha siki) yonunde; TR metinlerinden yalniz bitisik/ters sirali yas
 * beyani sertlesti. Liste disinda tek karar degisirse test kirmizi.
 */
const BILINCLI_SAPMALAR: Record<string, Partial<{ kriz: boolean; yasAlti: boolean; guard: string }>> = {
  '15yaş': { yasAlti: true },                                   // bitisik yazim (normalize)
  'yaşım 16': { yasAlti: true },                                // ters sira (normalize TR ifadesi)
  'voglio morire': { kriz: true },                              // capraz dil: TR seed'e Italyanca kriz
  'ho 16 anni': { yasAlti: true },                              // capraz dil
  'sono minorenne': { yasAlti: true },                          // capraz dil
  'il mio numero è 333 123 4567': { guard: 'iletisim' },        // TR seed +39 numara yazamaz
  "sono un'intelligenza artificiale": { guard: 'yasak_kelime' }, // tum paketlerin yasak kelimeleri
};

describe('TR altin test — guvenlik + cikti denetimi kararlari ayni', () => {
  it.each(GUVENLIK_KORPUSU.map((t) => [t]))('%s', async (metin) => {
    const { buildPersonaCard, validateReply, svc } = await yukle();
    const beklenen = { ...ALTIN.guvenlik[metin]!, ...BILINCLI_SAPMALAR[metin] };
    const sys = buildPersonaCard(personaKartVakalari()[0]![1]);
    const r = validateReply(metin, sys);
    expect({
      kriz: svc.krizSinyali(metin),
      kapanis: svc.kapanisSinyali(metin),
      yasAlti: svc.yasAltiBeyani(metin),
      guard: r.ok ? 'ok' : r.reason,
    }).toEqual(beklenen);
  });
});
