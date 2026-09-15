/**
 * TR seed (test) profillerini Supabase'e basar ve DOĞRULAR — Stage 2.
 *
 * Önkoşul: tools/seed_selection.py → tools/seed_prepare.py (--merge) → seed-profiles/tr-selection.json
 *          tools/seed_photos.py → seed-profiles/photos-manifest.json + seed-photos-cache/
 * Profil profil koşu (kontrol listesi + foto + DB + doğrulama): tools/seed_run.py — bu CLI'ı `--only … --json` ile çağırır.
 *
 * Kullanım (qulo-server/ içinde):
 *   npx tsx scripts/seed/seed-tr-test-profiles.ts --dry-run
 *   npx tsx scripts/seed/seed-tr-test-profiles.ts --only seed_0015 [--json]
 *   npx tsx scripts/seed/seed-tr-test-profiles.ts --limit 50 [--gender WOMAN|MAN]
 *   npx tsx scripts/seed/seed-tr-test-profiles.ts --verify-only [--only …]   # yalnız canlı kaydı kontrol eder
 * Silme: npx tsx scripts/seed/delete-tr-test-profiles.ts --confirm
 *
 * İdempotent: e-postası olan profil atlanır (ama yine doğrulanır). Fotoğrafı manifestte olmayan profil atlanır.
 * Şifre koşu başına rastgeledir ve hiçbir yere yazılmaz; seed hesapları zaten login'de reddedilir.
 * Çıkış kodu: doğrulaması geçmeyen profil varsa 2 (sürücü durur).
 */

import { randomBytes } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import { createSeedClient } from "./cli-env.js";
import {
  LOCALE,
  QUESTIONS_PER_PROFILE,
  SEED_PHOTO_CONTENT_TYPE,
  parseBank,
  parseSelection,
  photoMetaSchema,
  seedEmail,
  seedProfile,
  verifySeedProfile,
  type SeedResult,
  type SelectionEntry,
  type VerifyReport,
} from "./tr-seed-lib.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SELECTION = resolve(REPO_ROOT, "seed-profiles/tr-selection.json");
const MANIFEST = resolve(REPO_ROOT, "seed-profiles/photos-manifest.json");
const CACHE_DIR = resolve(REPO_ROOT, "qulo-server/seed-photos-cache");
const BANK_LIMIT = 1000;
const GENDERS = ["WOMAN", "MAN"] as const;
const EXIT_VERIFY_FAILED = 2;
const HEAD_TIMEOUT_MS = 15_000;

interface ManifestEntry { file?: string; error?: string; [k: string]: unknown }
export interface Args { dryRun: boolean; verifyOnly: boolean; json: boolean; only: Set<string>; gender?: SelectionEntry["gender"]; limit: number }

/** `--limit 0` = sınırsız. Dışa açık: testte doğrudan çağrılır (main import'ta koşmaz). */
const KNOWN_FLAGS = new Set(["--dry-run", "--verify-only", "--json", "--only", "--gender", "--limit"]);
const VALUE_FLAGS = new Set(["--only", "--gender", "--limit"]);

export function parseArgs(argv: string[]): Args {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!KNOWN_FLAGS.has(a)) throw new Error(`bilinmeyen argüman: ${a} (izinli: ${[...KNOWN_FLAGS].join(" ")})`); // yazım hatası gerçek koşuya dönüşmesin
    if (VALUE_FLAGS.has(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} değer ister`);
      i++;
    }
  }
  const get = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const gender = get("--gender");
  if (gender !== undefined && !GENDERS.includes(gender as SelectionEntry["gender"])) {
    throw new Error(`--gender ${GENDERS.join("|")} olmalı, verilen: ${gender}`);
  }
  const rawLimit = get("--limit");
  const limit = rawLimit === undefined ? 0 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 0) throw new Error(`--limit 0 (sınırsız) ya da pozitif tam sayı olmalı, verilen: ${rawLimit}`);
  return {
    dryRun: argv.includes("--dry-run"),
    verifyOnly: argv.includes("--verify-only"),
    json: argv.includes("--json"),
    only: new Set((get("--only") ?? "").split(",").filter(Boolean)),
    gender: gender as SelectionEntry["gender"] | undefined,
    limit,
  };
}

/** Manifest yolu yalnız cache dizininin altında olabilir — dışarısı public bucket'a yüklenmesin. */
function cachedPhotoPath(file: string): string {
  const abs = realpathSync(resolve(REPO_ROOT, file)); // symlink de çözülür: cache dışını gösteren link yüklenmez
  if (!abs.startsWith(realpathSync(CACHE_DIR) + sep)) throw new Error(`manifest yolu cache dışında: ${file}`);
  return abs;
}

async function headStatus(url: string): Promise<number> {
  const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
  return res.status;
}

function printResult(args: Args, e: SelectionEntry, res: SeedResult | null, verify: VerifyReport | null, index: string) {
  const record = { seed_id: e.seed_id, district: e.district, province: e.province, result: res, verify };
  if (args.json) { console.log(`RESULT ${JSON.stringify(record)}`); return; }
  const detail = !res ? "" : res.status === "error" ? `${res.step}: ${res.message}`
    : res.status === "created" && res.warnings.length ? `uyarı: ${res.warnings.join(" | ")}` : "";
  const v = verify ? (verify.ok ? "doğrulandı ✓" : `DOĞRULAMA HATASI: ${verify.checks.filter((c) => !c.ok).map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ""}`).join(", ")}`) : "";
  console.log(`[${index}] ${e.seed_id} ${e.district}/${e.province} → ${res?.status ?? "-"} ${res && res.status !== "error" ? res.id : ""} ${detail} ${v}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { entries: selected, invalid } = parseSelection(JSON.parse(readFileSync(SELECTION, "utf8")));
  if (invalid.length) {
    console.warn(`⚠️ şemaya uymayan ${invalid.length} kayıt atlandı: ${invalid.slice(0, 5).map((x) => `${x.seed_id} (${x.reason})`).join("; ")}`);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Record<string, ManifestEntry>;

  let entries = selected;
  const onlyMissing: { seed_id: string; message: string }[] = [];
  if (args.only.size) {
    entries = entries.filter((e) => args.only.has(e.seed_id));
    for (const id of args.only) {
      const inSelection = entries.some((e) => e.seed_id === id);
      if (!inSelection) onlyMissing.push({ seed_id: id, message: invalid.find((x) => x.seed_id === id)?.reason ?? "seçimde yok" });
      else if (!args.verifyOnly && !manifest[id]?.file) onlyMissing.push({ seed_id: id, message: "manifestte fotoğrafı yok (tools/seed_photos.py)" });
    }
  }
  if (args.gender) entries = entries.filter((e) => e.gender === args.gender);
  const withPhoto = args.verifyOnly ? entries : entries.filter((e) => manifest[e.seed_id]?.file);
  entries = args.limit ? withPhoto.slice(0, args.limit) : withPhoto;
  if (!args.json) console.log(`seçili: ${selected.length} · fotoğrafı hazır: ${withPhoto.length} · bu koşuda: ${entries.length}`);
  for (const m of onlyMissing) { // sessiz no-op yerine sürücünün okuyacağı hata satırı (dry-run dahil)
    const res: SeedResult = { status: "error", email: seedEmail(m.seed_id), step: "exists", message: m.message };
    if (args.json) console.log(`RESULT ${JSON.stringify({ seed_id: m.seed_id, result: res, verify: null })}`);
    else console.error(`⚠️ ${m.seed_id}: ${m.message}`);
  }
  if (onlyMissing.length) process.exitCode = EXIT_VERIFY_FAILED;

  if (args.dryRun) {
    for (const e of entries) console.log(`  ${e.seed_id} ${e.gender} ${e.age} ${e.district}/${e.province} (${e.lat}, ${e.lng}) ${e.job}`);
    return;
  }

  const client = createSeedClient();
  let bank: ReturnType<typeof parseBank>["bank"] = [];
  let passwordHash = "";
  if (!args.verifyOnly) {
    const { data: bankRows, error: bankError } = await client
      .from("ai_question_bank")
      .select("question_text, answers, category, hint, target_gender")
      .eq("locale", LOCALE)
      .eq("is_active", true)
      .limit(BANK_LIMIT);
    if (bankError) throw new Error(`ai_question_bank: ${bankError.message}`);
    const parsed = parseBank(bankRows ?? []);
    bank = parsed.bank;
    if (parsed.dropped && !args.json) console.warn(`⚠️ 4 cevaplı olmayan ${parsed.dropped} soru atlandı`);
    for (const g of GENDERS) {
      const target = g === "WOMAN" ? "female" : "male";
      const eligible = bank.filter((q) => !q.target_gender || q.target_gender === target).length;
      if (eligible < QUESTIONS_PER_PROFILE) throw new Error(`soru bankası ${g} için yetersiz: ${eligible}`);
    }
    passwordHash = await bcrypt.hash(randomBytes(24).toString("base64url"), 12);
  }

  const tally: Record<SeedResult["status"] | "verified" | "verify_failed", number> = { created: 0, skipped: 0, error: 0, verified: 0, verify_failed: 0 };
  tally.error += onlyMissing.length;
  for (const [i, e] of entries.entries()) {
    let res: SeedResult | null = null;
    if (!args.verifyOnly) {
      try {
        const m = manifest[e.seed_id];
        const meta = photoMetaSchema.parse(m);
        const bytes = readFileSync(cachedPhotoPath(m.file!));
        res = await seedProfile(client, e, { bytes, contentType: SEED_PHOTO_CONTENT_TYPE, meta }, bank, { passwordHash });
      } catch (err) {
        res = { status: "error", email: seedEmail(e.seed_id), step: "photo", message: err instanceof Error ? err.message : String(err) };
      }
      tally[res.status]++;
    }
    let verify: VerifyReport | null = null;
    if (!res || res.status !== "error") {
      verify = await verifySeedProfile(client, e, headStatus);
      tally[verify.ok ? "verified" : "verify_failed"]++;
    }
    printResult(args, e, res, verify, `${i + 1}/${entries.length}`);
  }
  if (!args.json) console.log(`\nbitti: ${tally.created} oluşturuldu, ${tally.skipped} zaten vardı, ${tally.error} hata · doğrulama ${tally.verified} ✓ / ${tally.verify_failed} ✗`);
  if (tally.verify_failed || tally.error) process.exitCode = EXIT_VERIFY_FAILED; // exit() stdout'u kesebilir
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(`❌ ${err instanceof Error ? err.message : err}`); process.exitCode = 1; });
}
