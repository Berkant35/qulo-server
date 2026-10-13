import { IT_PAKETI } from './it.js';
import { TR_PAKETI } from './tr.js';
import type { SeedLocale, SeedLocalePack } from './types.js';

/** Dil paketi kaydi — tek yer. Yeni dil: paket dosyasi + buraya bir satir (+ guvenlik.ts ifadeleri). */
export const PAKETLER: Readonly<Record<SeedLocale, SeedLocalePack>> = { tr: TR_PAKETI, it: IT_PAKETI };
export const TUM_PAKETLER: readonly SeedLocalePack[] = Object.values(PAKETLER);
