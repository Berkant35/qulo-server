/**
 * TR seed (test) profillerini Supabase'e basar — Stage 2.
 *
 * Önkoşul: tools/seed_selection.py → seed-profiles/tr-selection.json
 *          tools/seed_photos.py    → seed-profiles/photos-manifest.json + seed-photos-cache/
 *
 * Kullanım (qulo-server/ içinde):
 *   npx tsx scripts/seed/seed-tr-test-profiles.ts --dry-run
 *   npx tsx scripts/seed/seed-tr-test-profiles.ts --only seed_0015
 *   npx tsx scripts/seed/seed-tr-test-profiles.ts --limit 50 [--gender WOMAN|MAN]
 * Silme: npx tsx scripts/seed/delete-tr-test-profiles.ts --confirm
 *
 * İdempotent: e-postası olan profil atlanır. Fotoğrafı manifestte olmayan profil atlanır.
 * Şifre koşu başına rastgeledir ve hiçbir yere yazılmaz; seed hesapları zaten login'de reddedilir.
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { createSeedClient } from "./cli-env.js";
import {
  LOCALE,
  QUESTIONS_PER_PROFILE,
  SEED_PHOTO_CONTENT_TYPE,
  parseBank,
  parseSelection,
  seedProfile,
  type SeedResult,
  type SelectionEntry,
} from "./tr-seed-lib.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SELECTION = resolve(REPO_ROOT, "seed-profiles/tr-selection.json");
const MANIFEST = resolve(REPO_ROOT, "seed-profiles/photos-manifest.json");
const CACHE_DIR = resolve(REPO_ROOT, "qulo-server/seed-photos-cache");
const BANK_LIMIT = 1000;
const GENDERS = ["WOMAN", "MAN"] as const;

interface ManifestEntry { file?: string; error?: string }
interface Args { dryRun: boolean; only: Set<string>; gender?: SelectionEntry["gender"]; limit: number }

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const gender = get("--gender");
  if (gender !== undefined && !GENDERS.includes(gender as SelectionEntry["gender"])) {
    throw new Error(`--gender ${GENDERS.join("|")} olmalı, verilen: ${gender}`);
  }
  const rawLimit = get("--limit");
  const limit = rawLimit === undefined ? 0 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 0) throw new Error(`--limit pozitif tam sayı olmalı, verilen: ${rawLimit}`);
  return {
    dryRun: argv.includes("--dry-run"),
    only: new Set((get("--only") ?? "").split(",").filter(Boolean)),
    gender: gender as SelectionEntry["gender"] | undefined,
    limit,
  };
}

/** Manifest yolu yalnız cache dizininin altında olabilir — dışarısı public bucket'a yüklenmesin. */
function cachedPhotoPath(file: string): string {
  const abs = resolve(REPO_ROOT, file);
  if (!abs.startsWith(CACHE_DIR + sep)) throw new Error(`manifest yolu cache dışında: ${file}`);
  return abs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { entries: selected, invalid } = parseSelection(JSON.parse(readFileSync(SELECTION, "utf8")));
  if (invalid.length) console.warn(`⚠️ şemaya uymayan ${invalid.length} kayıt atlandı: ${invalid.slice(0, 10).join(", ")}`);
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Record<string, ManifestEntry>;

  let entries = selected;
  if (args.only.size) entries = entries.filter((e) => args.only.has(e.seed_id));
  if (args.gender) entries = entries.filter((e) => e.gender === args.gender);
  const withPhoto = entries.filter((e) => manifest[e.seed_id]?.file);
  entries = args.limit ? withPhoto.slice(0, args.limit) : withPhoto;
  console.log(`seçili: ${selected.length} · fotoğrafı hazır: ${withPhoto.length} · bu koşuda: ${entries.length}`);

  if (args.dryRun) {
    for (const e of entries) console.log(`  ${e.seed_id} ${e.gender} ${e.age} ${e.city} (${e.lat}, ${e.lng})`);
    return;
  }

  const client = createSeedClient();
  const { data: bankRows, error: bankError } = await client
    .from("ai_question_bank")
    .select("question_text, answers, category, hint, target_gender")
    .eq("locale", LOCALE)
    .eq("is_active", true)
    .limit(BANK_LIMIT);
  if (bankError) throw new Error(`ai_question_bank: ${bankError.message}`);
  const { bank, dropped } = parseBank(bankRows ?? []);
  if (dropped) console.warn(`⚠️ 4 cevaplı olmayan ${dropped} soru atlandı`);
  for (const g of GENDERS) {
    const target = g === "WOMAN" ? "female" : "male";
    const eligible = bank.filter((q) => !q.target_gender || q.target_gender === target).length;
    if (eligible < QUESTIONS_PER_PROFILE) throw new Error(`soru bankası ${g} için yetersiz: ${eligible}`);
  }

  const passwordHash = await bcrypt.hash(randomBytes(24).toString("base64url"), 12);
  const tally: Record<SeedResult["status"], number> = { created: 0, skipped: 0, error: 0 };

  for (const [i, e] of entries.entries()) {
    let res: SeedResult;
    try {
      const bytes = readFileSync(cachedPhotoPath(manifest[e.seed_id].file!));
      res = await seedProfile(client, e, { bytes, contentType: SEED_PHOTO_CONTENT_TYPE }, bank, { passwordHash });
    } catch (err) {
      res = { status: "error", email: e.seed_id, step: "upload", message: err instanceof Error ? err.message : String(err) };
    }
    tally[res.status]++;
    const detail = res.status === "error" ? `${res.step}: ${res.message}`
      : res.status === "created" && res.warnings.length ? `uyarı: ${res.warnings.join(" | ")}` : "";
    console.log(`[${i + 1}/${entries.length}] ${e.seed_id} ${e.city} → ${res.status} ${res.status !== "error" ? res.id : ""} ${detail}`);
  }
  console.log(`\nbitti: ${tally.created} oluşturuldu, ${tally.skipped} zaten vardı, ${tally.error} hata`);
}

main().catch((err) => { console.error(`❌ ${err instanceof Error ? err.message : err}`); process.exit(1); });
