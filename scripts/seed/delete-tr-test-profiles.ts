/**
 * TR seed (test) profillerini toplu siler — mantık tr-seed-lib.ts `deleteSeedProfiles`.
 *
 *   npx tsx scripts/seed/delete-tr-test-profiles.ts            # dry-run: kaç satır, kaç dosya
 *   npx tsx scripts/seed/delete-tr-test-profiles.ts --confirm  # siler
 *   npx tsx scripts/seed/delete-tr-test-profiles.ts --only seed_0015,seed_0064 --confirm  # yalnız bu profiller (QA reddi)
 *   npx tsx scripts/seed/delete-tr-test-profiles.ts --orphans [--confirm]  # hiçbir profilin kullanmadığı eski seed dosyaları
 */

import { createSeedClient } from "./cli-env.js";
import { cleanupSeedOrphans, deleteSeedProfiles } from "./tr-seed-lib.js";

async function main() {
  const argv = process.argv.slice(2);
  const confirm = argv.includes("--confirm");
  if (argv.includes("--orphans")) {
    const r = await cleanupSeedOrphans(createSeedClient(), { confirm });
    console.log(`hedef: ${new URL(process.env.SUPABASE_URL ?? "http://?").host} · seed dosyası: ${r.files} · kullanılan: ${r.referenced} · yetim: ${r.orphans.length}`);
    if (r.dryRun) { console.log(`dry-run — örnek: ${r.orphans.slice(0, 5).join(", ")} · silmek için --confirm`); return; }
    for (const w of r.warnings) console.error(`⚠️ ${w}`);
    console.log(`silindi: ${r.removed} yetim dosya`);
    return;
  }
  const onlyIdx = argv.indexOf("--only");
  const only = onlyIdx >= 0 ? (argv[onlyIdx + 1] ?? "").split(",").filter(Boolean) : undefined;
  if (onlyIdx >= 0 && !only?.length) throw new Error("--only virgülle seed_id listesi ister");
  const report = await deleteSeedProfiles(createSeedClient(), { confirm, only });
  console.log(`hedef: ${new URL(process.env.SUPABASE_URL ?? "http://?").host} · kapsam: ${only ? only.join(",") : "tüm seed profiller"}`);
  console.log(`seed profil: ${report.users} · storage dosyası: ${report.files}`);
  if (report.dryRun) { console.log("dry-run — silmek için --confirm"); return; }
  for (const w of report.warnings) console.error(`⚠️ ${w}`);
  console.log(`silindi: ${report.deletedUsers} kullanıcı (bağlı tablolar cascade), ${report.removedFiles} dosya`);
}

main().catch((err) => { console.error(`❌ ${err instanceof Error ? err.message : err}`); process.exit(1); });
