/**
 * Hetero seed'lerin bir kısmını gey/lezbiyen tercihine ayırır — mantık lgbt-seed-split-lib.ts.
 *
 *   npx tsx scripts/seed/split-lgbt-seeds.ts                       # dry-run: seçilecek liste
 *   npx tsx scripts/seed/split-lgbt-seeds.ts --men 30 --women 15   # hedef sayılar (varsayılan 30/15)
 *   npx tsx scripts/seed/split-lgbt-seeds.ts --confirm             # uygular
 */
import { createSeedClient } from "./cli-env.js";
import { applySplit, loadSeedCandidates, selectSeedsForSplit } from "./lgbt-seed-split-lib.js";

function sayi(argv: string[], flag: string, varsayilan: number): number {
  const i = argv.indexOf(flag);
  if (i < 0) return varsayilan;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${flag} pozitif tam sayı ister`);
  return n;
}

async function main() {
  const argv = process.argv.slice(2);
  const confirm = argv.includes("--confirm");
  const client = createSeedClient();
  const target = { men: sayi(argv, "--men", 30), women: sayi(argv, "--women", 15) };
  const cands = await loadSeedCandidates(client);
  const sel = selectSeedsForSplit(cands, target);

  console.log(`hedef: ${new URL(process.env.SUPABASE_URL ?? "http://?").host} · seed: ${cands.length}`);
  console.log(`zaten ayrılmış: ${sel.alreadyMen} erkek, ${sel.alreadyWomen} kadın · seçilen: ${sel.men.length} erkek, ${sel.women.length} kadın`);
  for (const s of [...sel.men, ...sel.women]) {
    console.log(`${s.gender === "MAN" ? "E→E" : "K→K"}  ${s.id}  ${s.age ?? "?"}  ${s.city ?? "?"}  ${(s.texts[0] ?? "").slice(0, 80)}`);
  }
  if (!confirm) { console.log("dry-run — uygulamak için --confirm"); return; }
  const r = await applySplit(client, sel);
  console.log(`yazıldı: ${r.men} erkek → MAN, ${r.women} kadın → WOMAN`);
}

main().catch((err) => { console.error(`❌ ${err instanceof Error ? err.message : err}`); process.exit(1); });
