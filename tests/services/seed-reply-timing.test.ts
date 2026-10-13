import { describe, it, expect, vi, afterEach } from 'vitest';
import { istanbulMinutes, isSleeping, isBusy, computeReplyDelayMs, yerelZaman } from '../../src/services/seed-reply-timing.js';
import type { SeedPersona, WorkPattern } from '../../src/types/seed-persona.js';

const persona = (over: Partial<SeedPersona> = {}): SeedPersona => ({
  responder_type: 'normal',
  work_pattern: 'serbest',
  sleep_window: { start_min: 30, end_min: 450 },   // 00:30 - 07:30
  style: { uzunluk: 'kisa', emoji: 'nadiren', yazim: 'kucuk_harf', enerji: 'kisa_kesen' },
  derived_at: '2026-09-16T00:00:00Z',
  model: 'test',
  ...over,
});

/** 2026-09-16 Çarşamba. UTC verilir; Istanbul = UTC+3 (DST yok). */
const utc = (h: number, m = 0, day = 16) => new Date(Date.UTC(2026, 8, day, h, m, 0));
const sabit = (v: number) => () => v;

afterEach(() => vi.restoreAllMocks());

const input = (over: Partial<Parameters<typeof computeReplyDelayMs>[0]> = {}) => ({
  persona: persona(), now: utc(11), fastMode: false, phase: 1 as const,
  messageCount: 20, msSinceLastExchange: null, rand: sabit(0.5), ...over,
});

describe('istanbulMinutes', () => {
  it('UTC+3 uygular ve gun asimini dogru sarar', () => {
    expect(istanbulMinutes(utc(11, 0))).toBe(14 * 60);      // 14:00
    expect(istanbulMinutes(utc(22, 30))).toBe(1 * 60 + 30); // ertesi gun 01:30
  });
});

describe('isSleeping', () => {
  it('gece yarisini asan pencereyi dogru degerlendirir', () => {
    expect(isSleeping(persona(), utc(0, 0))).toBe(true);    // 03:00 TR
    expect(isSleeping(persona(), utc(11, 0))).toBe(false);  // 14:00 TR
    expect(isSleeping(persona(), utc(21, 40))).toBe(true);  // 00:40 TR
  });
});

describe('isBusy', () => {
  const durum = (wp: WorkPattern, when: Date) => isBusy(persona({ work_pattern: wp }), when);

  it('ofis: hafta ici mesai saatinde mesgul, aksam degil', () => {
    expect(durum('ofis', utc(8))).toBe(true);    // Car 11:00 TR
    expect(durum('ofis', utc(18))).toBe(false);  // Car 21:00 TR
  });

  it('hafta_sonu_yogun: cumartesi mesgul, hafta ici degil', () => {
    expect(durum('hafta_sonu_yogun', utc(11, 0, 19))).toBe(true);  // Cmt 14:00 TR
    expect(durum('hafta_sonu_yogun', utc(11, 0, 16))).toBe(false); // Car 14:00 TR
  });

  it('vardiya_aksam: aksam mesgul, oglen degil', () => {
    expect(durum('vardiya_aksam', utc(18))).toBe(true);   // 21:00 TR
    expect(durum('vardiya_aksam', utc(10))).toBe(false);  // 13:00 TR
  });

  it('esnek: hicbir zaman mesgul degil', () => {
    expect(durum('esnek', utc(8))).toBe(false);
  });

  // Spec §2.3: `serbest` = "Belirgin pencere yok, gece de aktif". Kodda hafta ici
  // 10:00-13:00 mesgul sayiliyordu — spec'e aykiri bir pencere uydurulmustu.
  it('serbest: belirgin mesgul penceresi YOK (spec §2.3)', () => {
    expect(durum('serbest', utc(7))).toBe(false);   // Car 10:00 TR
    expect(durum('serbest', utc(9))).toBe(false);   // Car 12:00 TR
    expect(durum('serbest', utc(20))).toBe(false);  // Car 23:00 TR
    expect(durum('serbest', utc(11, 0, 19))).toBe(false); // Cmt 14:00 TR
  });

  it('vardiya_gece: gece mesgul, ogle degil (saran pencere)', () => {
    expect(durum('vardiya_gece', utc(21, 0, 15))).toBe(true);  // 16 Eylul 00:00 TR
    expect(durum('vardiya_gece', utc(9))).toBe(false);         // 12:00 TR
  });
});

describe('computeReplyDelayMs', () => {
  it('hizli test modunda 30 saniyeyi asmaz ve uykuyu yok sayar', () => {
    const ms = computeReplyDelayMs(input({ fastMode: true, now: utc(0), persona: persona({ responder_type: 'gec' }) }));
    expect(ms).toBeGreaterThanOrEqual(3_000);
    expect(ms).toBeLessThanOrEqual(30_000);
  });

  it('uyku penceresine dusen cevabi uyanma anina oteler', () => {
    // 03:00 TR'de gelen mesaj → uyanma 07:30 TR = 4.5 saat sonra (+ rand payi)
    const ms = computeReplyDelayMs(input({ now: utc(0) }));
    expect(ms).toBeGreaterThan(4 * 60 * 60 * 1000);
  });

  it('mesguliyet gecikmeyi buyutur', () => {
    const bos = computeReplyDelayMs(input({ persona: persona({ work_pattern: 'esnek' }) }));
    const mesgul = computeReplyDelayMs(input({ persona: persona({ work_pattern: 'ofis' }), now: utc(8) }));
    expect(mesgul).toBeGreaterThan(bos);
  });

  it('canli momentum gecikmeyi kisaltir', () => {
    const sogumus = computeReplyDelayMs(input({ msSinceLastExchange: 3 * 60 * 60 * 1000 }));
    const canli = computeReplyDelayMs(input({ msSinceLastExchange: 60 * 1000 }));
    expect(canli).toBeLessThan(sogumus);
  });

  it('soguma fazinda gecikme uzar', () => {
    expect(computeReplyDelayMs(input({ phase: 3 }))).toBeGreaterThan(computeReplyDelayMs(input({ phase: 1 })));
  });

  it('tavani 6 saati asmaz, tabani 15 saniyenin altina inmez', () => {
    const uzun = computeReplyDelayMs(input({ persona: persona({ responder_type: 'gec', work_pattern: 'ofis' }), now: utc(8), phase: 3, rand: sabit(0.999) }));
    expect(uzun).toBeLessThanOrEqual(6 * 60 * 60 * 1000);
    const kisa = computeReplyDelayMs(input({ persona: persona({ responder_type: 'anlik' }), messageCount: 1, rand: sabit(0) }));
    expect(kisa).toBeGreaterThanOrEqual(15_000);
  });

  it('ayni girdi + ayni rand ile deterministiktir', () => {
    expect(computeReplyDelayMs(input())).toBe(computeReplyDelayMs(input()));
  });

  it('bilerek gecikme dali gecikmeyi dortle carpar', () => {
    // rand() birden fazla kez cagriliyor: 1) taban cekimi 2) %12 olasilik kontrolu.
    // Sabit rand ikisini ayni degerden okudugu icin bu dali ayirt edemiyor — sira veriyoruz.
    const sira = (...v: number[]) => { let i = 0; return () => v[Math.min(i++, v.length - 1)]!; };
    const ortak = {
      persona: persona({ responder_type: 'normal', work_pattern: 'esnek' }),
      now: utc(11), fastMode: false, phase: 1 as const,
      messageCount: 20, msSinceLastExchange: null,
    };
    const tetiklenmeyen = computeReplyDelayMs({ ...ortak, rand: sira(0.5, 0.5) });
    const tetiklenen = computeReplyDelayMs({ ...ortak, rand: sira(0.5, 0.05) });
    expect(tetiklenen).toBe(tetiklenmeyen * 4);
  });
});

describe('persona saat dilimi (IANA, global seed dalgasi 2026-10-13)', () => {
  const roma = (over: Partial<SeedPersona> = {}) => persona({ tz: 'Europe/Rome', ...over });
  const an = (iso: string) => new Date(iso);

  it('yerelZaman: Europe/Rome Mart gecisi (29 Mart 2026, 02:00 CET -> 03:00 CEST)', () => {
    expect(yerelZaman(an('2026-03-29T00:30:00Z'), 'Europe/Rome')).toEqual({ dakika: 1 * 60 + 30, gun: 0 }); // 01:30 CET, Pazar
    expect(yerelZaman(an('2026-03-29T01:30:00Z'), 'Europe/Rome')).toEqual({ dakika: 3 * 60 + 30, gun: 0 }); // 03:30 CEST
  });

  it('yerelZaman: Europe/Rome Ekim gecisi (25 Ekim 2026, 03:00 CEST -> 02:00 CET, saat tekrar eder)', () => {
    expect(yerelZaman(an('2026-10-25T00:30:00Z'), 'Europe/Rome').dakika).toBe(2 * 60 + 30); // 02:30 CEST
    expect(yerelZaman(an('2026-10-25T01:30:00Z'), 'Europe/Rome').dakika).toBe(2 * 60 + 30); // 02:30 CET
  });

  it('yerel gun asimi: Roma gece yarisini gecince hafta gunu ilerler', () => {
    // 13 Eki 2026 Sali 22:30Z = Roma 14 Eki Carsamba 00:30
    expect(yerelZaman(an('2026-10-13T22:30:00Z'), 'Europe/Rome')).toEqual({ dakika: 30, gun: 3 });
  });

  it('tz yoksa Istanbul: eski sabit UTC+3 ile ayni (TR seed davranisi)', () => {
    const t = an('2026-10-13T22:30:00Z');
    expect(yerelZaman(t, undefined)).toEqual(yerelZaman(t, 'Europe/Istanbul'));
    expect(istanbulMinutes(t)).toBe(1 * 60 + 30);
    expect(isSleeping(persona(), t)).toBe(isSleeping(persona({ tz: 'Europe/Istanbul' }), t));
  });

  it('gecersiz tz Istanbul\'a duser, firlatmaz (tek bozuk persona taramayi dusurmez)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = an('2026-10-13T22:30:00Z');
    expect(yerelZaman(t, 'Europe/Romaa')).toEqual(yerelZaman(t, 'Europe/Istanbul'));
  });

  it('uyku Roma saatine gore: 05:00Z Roma 07:00 uykuda, Istanbul 08:00 uyanik', () => {
    const t = an('2026-10-14T05:00:00Z');
    expect(isSleeping(roma(), t)).toBe(true);
    expect(isSleeping(persona(), t)).toBe(false);
  });

  it('ofis mesaisi Roma saatine gore, yaz saati bitince de dogru', () => {
    const ofis = roma({ work_pattern: 'ofis' });
    // 14 Eki (CEST, UTC+2): 15:30Z = Roma 17:30 -> mesaide; Istanbul 18:30 -> degil
    expect(isBusy(ofis, an('2026-10-14T15:30:00Z'))).toBe(true);
    expect(isBusy(persona({ work_pattern: 'ofis' }), an('2026-10-14T15:30:00Z'))).toBe(false);
    // 4 Kasim (CET, UTC+1): 16:30Z = Roma 17:30 -> hala mesaide (sabit ofset olsaydi 18:30)
    expect(isBusy(ofis, an('2026-11-04T16:30:00Z'))).toBe(true);
    expect(isBusy(ofis, an('2026-11-04T17:30:00Z'))).toBe(false); // 18:30 CET
  });

  it('uykuya dusen cevap Roma uyanisina otelenir (06:00 Roma -> 07:30 Roma = ~90 dk)', () => {
    const ms = computeReplyDelayMs({
      persona: roma({ responder_type: 'anlik' }), now: an('2026-10-14T04:00:00Z'), fastMode: false,
      phase: 1, messageCount: 0, msSinceLastExchange: null, rand: sabit(0),
    });
    expect(ms).toBeGreaterThanOrEqual(90 * 60_000);
    expect(ms).toBeLessThan(92 * 60_000);
  });
});
