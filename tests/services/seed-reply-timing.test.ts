import { describe, it, expect } from 'vitest';
import { istanbulMinutes, isSleeping, isBusy, computeReplyDelayMs } from '../../src/services/seed-reply-timing.js';
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
});
