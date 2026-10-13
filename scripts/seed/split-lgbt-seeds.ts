/**
 * Hetero seed'lerin bir kısmını gey/lezbiyen tercihine ayırır — mantık lgbt-seed-split-lib.ts.
 *
 *   npx tsx scripts/seed/split-lgbt-seeds.ts                       # dry-run: seçilecek liste
 *   npx tsx scripts/seed/split-lgbt-seeds.ts --men 30 --women 15   # hedef sayılar (varsayılan 30/15)
 *   npx tsx scripts/seed/split-lgbt-seeds.ts --confirm             # uygular
 *   npx tsx scripts/seed/split-lgbt-seeds.ts --locale it --men 8 --women 4   # yalnız İtalyan seed'ler (İtalyanca cinsiyet sözlüğü)
 */
import { pathToFileURL } from "node:url";
import { parseFlags } from "./cli-args.js";
import { createSeedClient } from "./cli-env.js";
import { applySplit, loadSeedCandidates, selectSeedsForSplit } from "./lgbt-seed-split-lib.js";
import { resolveSeedLocale, type SeedLocale } from "./locales.js";

export interface SplitArgs { confirm: boolean; target: { men: number; women: number }; locale: SeedLocale }

function sayi(raw: string | undefined, flag: string, varsayilan: number): number {
  if (raw === undefined) return varsayilan;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${flag} pozitif tam sayı ister`);
  return n;
}

/** Katı ayrıştırma: yazım hatası (`--locale=it`) TR seed'lerinin tercihini değiştirmesin. */
export function parseSplitArgs(argv: readonly string[]): SplitArgs {
  const f = parseFlags(argv, { bool: ["--confirm"], value: ["--men", "--women", "--locale"] });
  return {
    confirm: f.has("--confirm"),
    target: { men: sayi(f.get("--men"), "--men", 30), women: sayi(f.get("--women"), "--women", 15) },
    locale: resolveSeedLocale(f.get("--locale")),
  };
}

async function main() {
  const { confirm, target, locale } = parseSplitArgs(process.argv.slice(2));
  const client = createSeedClient();
  const cands = await loadSeedCandidates(client, { locale });
  const sel = selectSeedsForSplit(cands, target, locale.locale);

  console.log(`hedef: ${new URL(process.env.SUPABASE_URL ?? "http://?").host} · locale: ${locale.locale} · seed: ${cands.length}`);
  console.log(`zaten ayrılmış: ${sel.alreadyMen} erkek, ${sel.alreadyWomen} kadın · seçilen: ${sel.men.length} erkek, ${sel.women.length} kadın`);
  for (const s of [...sel.men, ...sel.women]) {
    console.log(`${s.gender === "MAN" ? "E→E" : "K→K"}  ${s.id}  ${s.age ?? "?"}  ${s.city ?? "?"}  ${(s.texts[0] ?? "").slice(0, 80)}`);
  }
  if (!confirm) { console.log("dry-run — uygulamak için --confirm"); return; }
  const r = await applySplit(client, sel);
  console.log(`yazıldı: ${r.men} erkek → MAN, ${r.women} kadın → WOMAN`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(`❌ ${err instanceof Error ? err.message : err}`); process.exit(1); });
}
