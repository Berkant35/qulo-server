/**
 * Seed (test) profillerini toplu siler — mantık tr-seed-lib.ts `deleteSeedProfiles`. Kapsam YALNIZ `--locale`
 * (varsayılan tr): `seed-<prefix>_NNNN@qulo.seed` + `photos/seed/<prefix>_NNNN*.jpg`; başka locale'in seed'leri dokunulmaz.
 *
 *   npx tsx scripts/seed/delete-tr-test-profiles.ts                         # dry-run: kaç satır, kaç dosya (TR)
 *   npx tsx scripts/seed/delete-tr-test-profiles.ts --confirm               # siler (TR)
 *   npx tsx scripts/seed/delete-tr-test-profiles.ts --locale it --confirm   # yalnız İtalyan seed'ler (seed-it_%)
 *   npx tsx scripts/seed/delete-tr-test-profiles.ts --only seed_0015,seed_0064 --confirm  # yalnız bu profiller (QA reddi)
 *   npx tsx scripts/seed/delete-tr-test-profiles.ts --orphans [--confirm]  # hiçbir profilin kullanmadığı eski seed dosyaları
 */

import { pathToFileURL } from "node:url";
import { parseFlags, parseSeedIdList } from "./cli-args.js";
import { createSeedClient } from "./cli-env.js";
import { resolveSeedLocale, type SeedLocale } from "./locales.js";
import { cleanupSeedOrphans, deleteSeedProfiles } from "./tr-seed-lib.js";

export interface DeleteArgs { confirm: boolean; orphans: boolean; only?: string[]; locale: SeedLocale }

/** Katı ayrıştırma: `--loacle it` / `--locale=it` yazım hatası TR'ye düşüp `--confirm` ile TR seed'lerini silmesin. */
export function parseDeleteArgs(argv: readonly string[]): DeleteArgs {
  const f = parseFlags(argv, { bool: ["--confirm", "--orphans"], value: ["--only", "--locale"] });
  const rawOnly = f.get("--only");
  return { confirm: f.has("--confirm"), orphans: f.has("--orphans"), only: rawOnly ? parseSeedIdList(rawOnly) : undefined, locale: resolveSeedLocale(f.get("--locale")) };
}

async function main() {
  const { confirm, orphans, only, locale } = parseDeleteArgs(process.argv.slice(2));
  const host = new URL(process.env.SUPABASE_URL ?? "http://?").host;
  if (orphans) {
    const r = await cleanupSeedOrphans(createSeedClient(), { confirm, locale });
    console.log(`hedef: ${host} · locale: ${locale.locale} · seed dosyası: ${r.files} · kullanılan: ${r.referenced} · yetim: ${r.orphans.length}`);
    if (r.dryRun) { console.log(`dry-run — örnek: ${r.orphans.slice(0, 5).join(", ")} · silmek için --confirm`); return; }
    for (const w of r.warnings) console.error(`⚠️ ${w}`);
    console.log(`silindi: ${r.removed} yetim dosya`);
    return;
  }
  const report = await deleteSeedProfiles(createSeedClient(), { confirm, only, locale });
  console.log(`hedef: ${host} · locale: ${locale.locale} · kapsam: ${only ? only.join(",") : `tüm seed-${locale.keyPrefix}_ profilleri`}`);
  console.log(`seed profil: ${report.users} · storage dosyası: ${report.files} (başka satırın kullandığı dosya korunur)`);
  if (report.dryRun) { console.log("dry-run — silmek için --confirm"); return; }
  for (const w of report.warnings) console.error(`⚠️ ${w}`);
  console.log(`silindi: ${report.deletedUsers} kullanıcı (bağlı tablolar cascade), ${report.removedFiles} dosya`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(`❌ ${err instanceof Error ? err.message : err}`); process.exit(1); });
}
