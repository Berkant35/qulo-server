import type { SeedPersona, ResponderType } from '../types/seed-persona.js';
import { TR_PAKETI } from './seed-locale/tr.js';

/**
 * Persona saat dilimi yoksa (417 TR seed'in persona'si `tz` alani olmadan turetildi) Istanbul.
 * Turkiye 2016'dan beri kalici UTC+3: eski sabit +180 dk hesabiyla ayni sonuc.
 */
export const VARSAYILAN_TZ = TR_PAKETI.varsayilanTz;
const GUN = 24 * 60;

export interface TimingInput {
  persona: SeedPersona;
  now: Date;
  fastMode: boolean;
  phase: 1 | 2 | 3 | 4;
  messageCount: number;
  msSinceLastExchange: number | null;
  rand: () => number;
}

const HAFTA_GUNU: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * IANA dilimi basina tek bicimleyici (kurulumu pahali; presence tiki 417 seed x 2-3 cagri).
 * Gecersiz ad (yanlis yazilmis `tz`) RangeError atar: tum tarama dusmesin diye Istanbul'a duser.
 */
const bicimleyiciler = new Map<string, Intl.DateTimeFormat>();
function bicimleyici(tz: string): Intl.DateTimeFormat {
  let f = bicimleyiciler.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit',
      });
    } catch {
      console.warn(`[SeedTiming] gecersiz saat dilimi "${tz}", ${VARSAYILAN_TZ} kullaniliyor`);
      f = bicimleyici(VARSAYILAN_TZ);
    }
    bicimleyiciler.set(tz, f);
  }
  return f;
}

/** Persona'nin yerel saati: dakika (0-1439) ve hafta gunu (0=Pazar). Yaz saati Intl'den. */
export function yerelZaman(now: Date, tz: string | null | undefined): { dakika: number; gun: number } {
  const parcalar = bicimleyici(tz || VARSAYILAN_TZ).formatToParts(now);
  const al = (tip: Intl.DateTimeFormatPartTypes) => parcalar.find((p) => p.type === tip)?.value ?? '';
  return { dakika: Number(al('hour')) * 60 + Number(al('minute')), gun: HAFTA_GUNU[al('weekday')] ?? 0 };
}

/** Geriye uyumlu: Istanbul yerel dakikasi (testler ve eski cagiranlar). */
export function istanbulMinutes(now: Date): number {
  return yerelZaman(now, VARSAYILAN_TZ).dakika;
}

const personaTz = (persona: SeedPersona) => persona.tz ?? VARSAYILAN_TZ;

function pencereIcinde(dakika: number, start: number, end: number): boolean {
  return start <= end ? dakika >= start && dakika < end : dakika >= start || dakika < end;
}

export function isSleeping(persona: SeedPersona, now: Date): boolean {
  const { start_min, end_min } = persona.sleep_window;
  return pencereIcinde(yerelZaman(now, personaTz(persona)).dakika, start_min, end_min);
}

export function isBusy(persona: SeedPersona, now: Date): boolean {
  const { dakika: dk, gun } = yerelZaman(now, personaTz(persona));
  const haftaIci = gun >= 1 && gun <= 5;
  switch (persona.work_pattern) {
    case 'ofis': return haftaIci && pencereIcinde(dk, 9 * 60, 18 * 60);
    case 'okul': return haftaIci && pencereIcinde(dk, 9 * 60, 16 * 60);
    case 'vardiya_aksam': return pencereIcinde(dk, 18 * 60, 1 * 60);
    case 'vardiya_gece': return pencereIcinde(dk, 23 * 60, 7 * 60);
    case 'hafta_sonu_yogun': return !haftaIci && pencereIcinde(dk, 10 * 60, 22 * 60);
    // Spec §2.3: `serbest` icin belirgin pencere YOK, gece de aktif. Uydurulmus bir
    // hafta ici 10:00-13:00 penceresi vardi; spec'e geri donuldu.
    case 'serbest':
    case 'esnek': return false;
  }
}

const TABAN: Record<ResponderType, [number, number]> = {
  anlik: [10_000, 2 * 60_000],
  normal: [2 * 60_000, 20 * 60_000],
  gec: [30 * 60_000, 3 * 60 * 60_000],
  duzensiz: [60_000, 4 * 60 * 60_000],
};

const MIN_MS = 15_000;
const MAX_MS = 6 * 60 * 60 * 1000;
const HIZLI_MIN = 3_000;
const HIZLI_MAX = 30_000;

export function computeReplyDelayMs(i: TimingInput): number {
  const [alt, ust] = TABAN[i.persona.responder_type];
  let ms = alt + i.rand() * (ust - alt);

  if (i.fastMode) {
    // Gercek ritmi orantili koru ama saniyelere sikistir; uyku/mesai yok sayilir.
    const oran = (ms - TABAN.anlik[0]) / (TABAN.duzensiz[1] - TABAN.anlik[0]);
    return Math.round(HIZLI_MIN + oran * (HIZLI_MAX - HIZLI_MIN));
  }

  if (isBusy(i.persona, i.now)) ms *= 4;
  if (i.msSinceLastExchange !== null) ms *= i.msSinceLastExchange < 10 * 60_000 ? 0.4 : i.msSinceLastExchange > 60 * 60_000 ? 1.5 : 1;
  if (i.messageCount <= 5) ms *= 0.6;
  if (i.phase >= 3) ms *= 1.8;
  if (i.rand() < 0.12) ms *= 4;   // bilerek gecikme

  let hedefMs = Math.round(ms);

  // Uyku penceresine dusuyorsa uyanma anina otele (+0-40 dk).
  const varis = new Date(i.now.getTime() + hedefMs);
  if (isSleeping(i.persona, varis)) {
    const varisDk = yerelZaman(varis, personaTz(i.persona)).dakika;
    const uyanis = i.persona.sleep_window.end_min;
    const kalanDk = (uyanis - varisDk + GUN) % GUN;
    hedefMs += kalanDk * 60_000 + Math.round(i.rand() * 40 * 60_000);
  }

  return Math.min(Math.max(hedefMs, MIN_MS), MAX_MS);
}

/**
 * Persona karti bos seed icin varsayilan — TEK kaynak: tarama, kuyruk isleme, onizleme
 * (seed-reply-preview) ve cevrimici ritmi (seed-presence) ayni nesneyi kullanir; hicbiri
 * degistirmez. Eskiden uc birebir kopyaydi (2026-09-27).
 */
export const VARSAYILAN_PERSONA: SeedPersona = {
  responder_type: 'normal', work_pattern: 'esnek',
  sleep_window: { start_min: 30, end_min: 450 },
  style: { uzunluk: 'kisa', emoji: 'nadiren', yazim: 'gevsek', enerji: 'soru_soran' },
  derived_at: '', model: 'fallback',
};

export function fazFor(messageCount: number): 1 | 2 | 3 | 4 {
  if (messageCount <= 10) return 1;
  if (messageCount <= 15) return 2;
  if (messageCount <= 24) return 3;
  return 4;
}
