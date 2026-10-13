import { PAKETLER, TUM_PAKETLER } from './paketler.js';
import { TR_PAKETI } from './tr.js';
import type { SeedLocale, SeedLocalePack } from './types.js';

export type { SeedLocale, SeedLocalePack, PersonaKartMetni } from './types.js';
export { TR_PAKETI } from './tr.js';
export { IT_PAKETI } from './it.js';
export { krizSinyali, yasAltiBeyani, krizCevabi, GORUNMEZ, VARYASYON } from './guvenlik.js';
export { TUM_PAKETLER } from './paketler.js';

/** Paketi olan diller — derive/seed hattinin `--locale` dogrulamasi icin. */
export const SEED_LOCALES = Object.keys(PAKETLER) as SeedLocale[];

/**
 * Seed'in dil paketi: anahtar `users.locale` (Discover seed on-filtresiyle ayni alan).
 * Bilinmeyen / bos deger TR'ye duser — 417 mevcut seed'in hepsi `tr` ve kolon NOT NULL
 * DEFAULT 'tr'; yeni bir dil paketi eklenmeden o dilde seed acmak TR botu calistirir.
 */
export function seedLocalePack(locale: unknown): SeedLocalePack {
  return typeof locale === 'string' && Object.hasOwn(PAKETLER, locale) ? PAKETLER[locale as SeedLocale] : TR_PAKETI;
}

/** `last_error` on eki: paketi olmayan dilde seed bot olarak YAZMAZ. */
export const PAKETSIZ_DIL = 'seed dil paketi yok';

/**
 * Yazma yollari icin kesin secici: bos/eksik locale TR (kolon NOT NULL DEFAULT 'tr'; eski satir ve
 * test fiksturleri), paketi olmayan dolu bir locale (ör. ilk `es` dalgasi paketsiz eklendi) ise null —
 * cagiran satiri iptal eder. Sessizce TR'ye dusmek Ispanyol seed'e Turkce yazdirirdi (inceleme 2026-10-13).
 */
export function seedPaketiKesin(locale: unknown): SeedLocalePack | null {
  if (locale == null || locale === '') return TR_PAKETI;
  return typeof locale === 'string' && Object.hasOwn(PAKETLER, locale) ? PAKETLER[locale as SeedLocale] : null;
}

/**
 * Kisilik etiketi karsilastirma anahtari. Yerel ayarsiz `toLowerCase`: 'tr' kucultmesi
 * Italyanca "Introverso"yu "ıntroverso" yapar ve eslesme kaybolur (iki taraf ayni islevden gecer).
 */
export function kisilikAnahtari(etiket: string): string {
  return etiket.trim().toLowerCase();
}

/** Tum paketlerin kisilik etiketleri (responderTypeFor locale bilmeden calisir: derive hatti). */
export const DISA_DONUK_ETIKETLERI: ReadonlySet<string> = new Set(
  TUM_PAKETLER.flatMap((p) => p.kisilik.disaDonuk.map(kisilikAnahtari)),
);
export const ICE_DONUK_ETIKETLERI: ReadonlySet<string> = new Set(
  TUM_PAKETLER.flatMap((p) => p.kisilik.iceDonuk.map(kisilikAnahtari)),
);
