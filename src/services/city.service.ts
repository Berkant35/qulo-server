import { CITIES, type CityEntry } from "../data/cities.js";

/** Istemciye giden sehir — koordinat donmez (sunucu yazar), arama takma adlari donmez. */
export interface PublicCity {
  id: string;
  name: string;
  country: string;
}

export const CITY_SEARCH_MAX_LIMIT = 100;

/**
 * Arama icin katlama: kucuk harf (Turkce I/ı/İ dahil), aksan/diakritik silme. "istanbul", "İSTANBUL",
 * "Istanbul" ve "ıstanbul" ayni anahtara duser; "sao paulo" → "São Paulo".
 */
export function foldForSearch(text: string): string {
  return text
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .replace(/ı/g, "i")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ß/g, "ss")
    .trim();
}

interface IndexedCity {
  entry: CityEntry;
  keys: string[];
}

const BY_ID = new Map(CITIES.map((c) => [c.id, c]));
const INDEX: IndexedCity[] = CITIES.map((entry) => ({
  entry,
  keys: [entry.name, ...(entry.aliases ?? [])].map(foldForSearch),
}));
/** Listedeki ulkeler, ilk gorulme sirasiyla (data/cities.ts kullanici sayisina gore dizili). */
const COUNTRIES: readonly string[] = [...new Set(CITIES.map((c) => c.country))];

function toPublic(c: CityEntry): PublicCity {
  return { id: c.id, name: c.name, country: c.country };
}

/**
 * Konumsuz yedek yol (2.0.18 plan madde 9) — statik liste, DB/ag yok (maliyet sifir).
 * Siralama: ada BASTAN uyan once, sonra icinde gecen; esitlikte listedeki sira (TR plaka sirasi,
 * digerlerinde buyukluk) korunur.
 */
class CityService {
  countries(): readonly string[] {
    return COUNTRIES;
  }

  search(opts: { country?: string; q?: string; limit?: number }): PublicCity[] {
    const limit = Math.min(Math.max(opts.limit ?? CITY_SEARCH_MAX_LIMIT, 1), CITY_SEARCH_MAX_LIMIT);
    const needle = opts.q ? foldForSearch(opts.q) : "";
    const pool = opts.country ? INDEX.filter((c) => c.entry.country === opts.country) : INDEX;
    if (!needle) return pool.slice(0, limit).map((c) => toPublic(c.entry));

    const prefix: CityEntry[] = [];
    const contains: CityEntry[] = [];
    for (const c of pool) {
      if (c.keys.some((k) => k.startsWith(needle))) prefix.push(c.entry);
      else if (c.keys.some((k) => k.includes(needle))) contains.push(c.entry);
    }
    return [...prefix, ...contains].slice(0, limit).map(toPublic);
  }

  /** Sunucu tarafi: koordinat dahil tam kayit; bilinmeyen id → null. */
  findById(id: string): CityEntry | null {
    return BY_ID.get(id) ?? null;
  }
}

export const cityService = new CityService();
