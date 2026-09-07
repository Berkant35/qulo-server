/**
 * Yerel saat tahmini — Faz 1 "cok basit" kurali:
 *  - locale 'tr' → UTC+3 (Turkiye yaz saati uygulamiyor; boylamdan hesap Istanbul icin +2 verirdi)
 *  - boylam varsa round(lng / 15)
 *  - hicbiri yoksa UTC
 * Yaz saati bilinmiyor (±1 saat sapma kabul). Faz 3'te uygulama kendi saat dilimini gonderecek.
 */
export const DAY_MS = 24 * 60 * 60 * 1000;

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
