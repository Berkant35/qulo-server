/**
 * Seed CLI'ları için katı bayrak ayrıştırıcı. Bilinmeyen argüman (yazım hatası `--loacle`, `--locale=it` biçimi) ve
 * değersiz değer bayrağı FIRLATIR: silme CLI'ında sessizce varsayılana (tr) düşmek `--confirm` ile tüm TR seed'lerini
 * silerdi (2026-10-13 incelemesi). Tüm seed CLI'ları (seed / delete / split / derive) bunu kullanır.
 */

export interface CliFlags {
  has(flag: string): boolean;
  get(flag: string): string | undefined;
}

export function parseFlags(argv: readonly string[], known: { bool: readonly string[]; value: readonly string[] }): CliFlags {
  const all = new Set([...known.bool, ...known.value]);
  const values = new Map<string, string>();
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!all.has(a)) throw new Error(`bilinmeyen argüman: ${a} (izinli: ${[...all].join(" ")})`);
    seen.add(a);
    if (known.value.includes(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} değer ister`);
      values.set(a, v);
      i++;
    }
  }
  return { has: (flag) => seen.has(flag), get: (flag) => values.get(flag) };
}

/** `--only seed_0015,seed_0064` → doğrulanmış liste; biçim dışı değer (`15`, `tr_0015`) sessiz no-op yerine hata. */
export function parseSeedIdList(raw: string): string[] {
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) throw new Error("--only virgülle seed_id listesi ister");
  const bad = ids.filter((s) => !/^seed_\d{4}$/.test(s));
  if (bad.length) throw new Error(`--only seed_NNNN biçiminde olmalı: ${bad.join(", ")}`);
  return ids;
}
