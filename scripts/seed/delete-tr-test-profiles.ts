/**
 * TR seed (test) profillerini toplu siler — mantık tr-seed-lib.ts `deleteSeedProfiles`.
 *
 *   npx tsx scripts/seed/delete-tr-test-profiles.ts            # dry-run: kaç satır, kaç dosya
 *   npx tsx scripts/seed/delete-tr-test-profiles.ts --confirm  # siler
 */

import { createSeedClient } from "./cli-env.js";
import { deleteSeedProfiles } from "./tr-seed-lib.js";

async function main() {
  const confirm = process.argv.includes("--confirm");
  const report = await deleteSeedProfiles(createSeedClient(), { confirm });
  console.log(`seed profil: ${report.users} · storage dosyası: ${report.files}`);
  if (report.dryRun) { console.log("dry-run — silmek için --confirm"); return; }
  for (const w of report.warnings) console.error(`⚠️ ${w}`);
  console.log(`silindi: ${report.deletedUsers} kullanıcı (bağlı tablolar cascade), ${report.removedFiles} dosya`);
}

main().catch((err) => { console.error(`❌ ${err instanceof Error ? err.message : err}`); process.exit(1); });
