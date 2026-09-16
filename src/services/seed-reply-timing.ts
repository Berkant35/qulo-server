import type { SeedPersona, ResponderType } from '../types/seed-persona.js';

/** Turkiye 2016'dan beri kalici UTC+3 uygular; yaz saati gecisi yoktur. */
const TR_OFFSET_MIN = 180;
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

export function istanbulMinutes(now: Date): number {
  return (now.getUTCHours() * 60 + now.getUTCMinutes() + TR_OFFSET_MIN) % GUN;
}

/** 0=Pazar ... 6=Cumartesi, Istanbul yereline gore. */
function istanbulDay(now: Date): number {
  const asildi = now.getUTCHours() * 60 + now.getUTCMinutes() + TR_OFFSET_MIN >= GUN ? 1 : 0;
  return (now.getUTCDay() + asildi) % 7;
}

function pencereIcinde(dakika: number, start: number, end: number): boolean {
  return start <= end ? dakika >= start && dakika < end : dakika >= start || dakika < end;
}

export function isSleeping(persona: SeedPersona, now: Date): boolean {
  const { start_min, end_min } = persona.sleep_window;
  return pencereIcinde(istanbulMinutes(now), start_min, end_min);
}

export function isBusy(persona: SeedPersona, now: Date): boolean {
  const dk = istanbulMinutes(now);
  const gun = istanbulDay(now);
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
    const varisDk = istanbulMinutes(varis);
    const uyanis = i.persona.sleep_window.end_min;
    const kalanDk = (uyanis - varisDk + GUN) % GUN;
    hedefMs += kalanDk * 60_000 + Math.round(i.rand() * 40 * 60_000);
  }

  return Math.min(Math.max(hedefMs, MIN_MS), MAX_MS);
}
