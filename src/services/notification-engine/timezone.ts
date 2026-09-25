/**
 * Yerel saat tahmini — Faz 1 "cok basit" kurali:
 *  - locale 'tr' → UTC+3 (Turkiye yaz saati uygulamiyor; boylamdan hesap Istanbul icin +2 verirdi)
 *  - boylam varsa round(lng / 15)
 *  - hicbiri yoksa UTC
 * Yaz saati bilinmiyor (±1 saat sapma kabul). Faz 3'te uygulama kendi saat dilimini gonderecek.
 */
export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

export interface TimezoneSource {
  locale?: string | null;
  lng?: number | null;
}

export function utcOffsetHours(user: TimezoneSource): number {
  if (user.locale === 'tr') return 3;
  if (typeof user.lng === 'number' && Number.isFinite(user.lng)) {
    return Math.max(-12, Math.min(14, Math.round(user.lng / 15)));
  }
  return 0;
}

export function localHour(now: Date, offsetHours: number): number {
  return (((now.getUTCHours() + offsetHours) % 24) + 24) % 24;
}

/** Kullanicinin yerel saatinin bir tikteki goruntusu — tekrarlayan kampanya pencere/gun kararlari icin. */
export interface LocalClock {
  hour: number;
  /** 0-1439 */
  minuteOfDay: number;
  /** YYYY-MM-DD (yerel) — gunluk dedupe anahtari. */
  date: string;
  /** ISO: 1=Pazartesi .. 7=Pazar */
  isoWeekday: number;
  /** Yerel gunun epoch gun sayisi — varyant rotasyonu icin monoton sayac. */
  dayIndex: number;
}

export function localClock(now: Date, offsetHours: number): LocalClock {
  const shifted = new Date(now.getTime() + offsetHours * 60 * 60 * 1000);
  const hour = shifted.getUTCHours();
  return {
    hour,
    minuteOfDay: hour * 60 + shifted.getUTCMinutes(),
    date: shifted.toISOString().slice(0, 10),
    isoWeekday: ((shifted.getUTCDay() + 6) % 7) + 1,
    dayIndex: Math.floor(shifted.getTime() / DAY_MS),
  };
}
