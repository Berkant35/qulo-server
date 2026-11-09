/**
 * Silinmiş TR seed profillerini yedekten geri yükler (2026-11-09). 2026-10-21'de 417 TR seed `users`'tan hard silindi;
 * satırlar `_bak_seed_users_20261021`'de (persona + photo_prompt dolu), fotoğraflar Storage'da (`photos/seed/tr_*`) duruyor.
 *
 * Kullanım (qulo-server/ içinde):
 *   npx tsx scripts/seed/restore-from-backup.ts --only <selected.json> [--exclude <exclude.json>]           # KURU (varsayılan)
 *   npx tsx scripts/seed/restore-from-backup.ts --only <selected.json> [--exclude <exclude.json>] --apply   # yazar
 * JSON: `{ "items": [{ "id": "<uuid>" , ... }] }`, `[{ "id": … }]` ya da `["<uuid>", …]`. `--only` yoksa yedeğin tamamı aday
 * (yalnız kuru çalıştırmada; `--apply` `--only` ister).
 *
 * Ne yazar (profil başına, `--apply`):
 *   users        yedek satırı AYNI id ile; null alanlar gönderilmez (yeni kolonlar — location_source vb. — varsayılana düşer).
 *                Bayraklar zorlanır: is_seed_profile=true, is_test_account=true (bot yazma kapısı ikisini birden ister),
 *                is_test_admin=false, email_notifications_enabled=false (adres @qulo.seed → bounce; kod tarafı c51b389).
 *                Silinen tablolardan türeyen sayaçlar sıfırlanır: question_count 0 ile girer (soru trigger'ı +1 sayar; sonra
 *                açıkça 3'e eşitlenir), like_received_count (beğeniler CASCADE ile gitti).
 *   user_details buildDetailsRow — seed basımının yazdığı biçim (seçim kaydından).
 *   diller       set_user_languages RPC (054 sonrası tek yol).
 *   questions    pickQuestions — seed_id'ye bağlı deterministik RNG, AYNI anahtar; ai_question_bank (tr) 2026-03-20'den beri
 *                değişmedi → silinmeden öncekiyle aynı 3 soru. Silinen soruların kendisi yedekte yok (CASCADE).
 *   Fotoğraf     yüklenmez: yedekteki URL aynen; doğrulamada HEAD 200 aranır. Ücretli API yok.
 *   Eşleşmeler   GERİ YÜKLENMEZ (`_bak_seed_matches_20261021`): karşı taraf onları unuttu, mesajlar yok → hayalet eşleşme.
 * Sonra verifySeedProfile (HEAD 200, klon, 3 soru, detay, dil) + geri yükleme kontrolleri (bayrak, persona, e-posta kapalı).
 *
 * İdempotent: users'ta zaten olan id atlanır (yine doğrulanır). Çıkış kodu: hata ya da doğrulama düşüğü varsa 2.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { fetchAll } from "../../src/utils/fetch-all.js";
import { parseFlags } from "./cli-args.js";
import { createSeedClient } from "./cli-env.js";
import { TR_SEED_LOCALE, parseSeedEmail, seedDataPaths } from "./locales.js";
import {
  QUESTIONS_PER_PROFILE,
  buildDetailsRow,
  parseBank,
  parseSelection,
  pickQuestions,
  verifySeedProfile,
  type BankQuestion,
  type HeadFn,
  type SeedClient,
  type SelectionEntry,
  type VerifyCheck,
} from "./tr-seed-lib.js";

export const BACKUP_TABLE = "_bak_seed_users_20261021";
const CFG = TR_SEED_LOCALE;
const ID_CHUNK = 100; // PostgREST URL sınırı: 416 id tek `.in()`a konmaz
const BANK_LIMIT = 1000;
const EXIT_FAILED = 2;
const HEAD_TIMEOUT_MS = 15_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Yedekten taşınmayan alanlar: oturum/doğrulama sırları ve silinen tablolardan türeyen sayaçlar. */
const DROPPED_COLUMNS = ["push_token", "verify_token", "token_expires_at", "rc_customer_id", "question_count", "like_received_count", "daily_swipes_used", "daily_undos_used"] as const;

export interface RestoreArgs { apply: boolean; json: boolean; only?: string; exclude?: string }

export function parseRestoreArgs(argv: readonly string[]): RestoreArgs {
  const f = parseFlags(argv, { bool: ["--apply", "--json"], value: ["--only", "--exclude"] });
  // Yedekte 102 erkek + 172 karıncalı dahil 417 profil var: listesiz --apply hepsini geri getirirdi (kapsam 50 kadın).
  if (f.has("--apply") && !f.get("--only")) throw new Error("--apply yalnız --only <json> ile (tüm yedeği toptan geri yükleme yok)");
  return { apply: f.has("--apply"), json: f.has("--json"), only: f.get("--only"), exclude: f.get("--exclude") };
}

/** `{items:[{id}]}` | `[{id}]` | `["uuid"]` → id kümesi. Biçim dışı id sessiz no-op yerine hata. */
export function parseIdList(raw: unknown, label: string): Set<string> {
  const list = Array.isArray(raw) ? raw : (raw as { items?: unknown })?.items;
  if (!Array.isArray(list)) throw new Error(`${label}: dizi ya da {items: [...]} bekleniyor`);
  const ids = list.map((x) => (typeof x === "string" ? x : (x as { id?: unknown })?.id));
  const bad = ids.filter((id) => typeof id !== "string" || !UUID_RE.test(id));
  if (bad.length) throw new Error(`${label}: geçersiz id (${bad.length}): ${JSON.stringify(bad.slice(0, 3))}`);
  return new Set(ids as string[]);
}

type BackupRow = Record<string, unknown> & { id: string; email: string };

export type RestoreStatus = "planned" | "created" | "skipped" | "error";
export interface RestoreItem {
  id: string;
  seed_id: string | null;
  status: RestoreStatus;
  message?: string;
  warnings: string[];
  verify?: { ok: boolean; failed: VerifyCheck[] };
}
export interface RestoreReport {
  apply: boolean;
  backupRows: number;
  excluded: number;
  candidates: number;
  items: RestoreItem[];
  tally: Record<RestoreStatus | "verified" | "verify_failed", number>;
}

/** Yedek satırı → `users` insert satırı. Null alanlar atılır (varsayılana düşsün), bayraklar zorlanır. */
export function buildRestoreUserRow(row: BackupRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (v !== null && v !== undefined) out[k] = v;
  for (const k of DROPPED_COLUMNS) delete out[k];
  return {
    ...out,
    is_seed_profile: true,
    is_test_account: true,
    is_test_admin: false,
    is_deleted: false,
    is_banned: false,
    is_online: false,
    email_notifications_enabled: false,
    question_count: 0, // soru trigger'ı her insert'te +1 yazar; yedekteki 3 ile girerse 6 olurdu
  };
}

/**
 * Doğrulama girdisi: seçim kaydının üstüne yedeğin (= canlıdaki son hâl) alanları. Yedek, seçimden sonra değişmiş olabilir
 * (LGBT bölmesi, düzenlemeler); doğrulama "DB'ye niyet ettiğimiz satır yazıldı mı"yı sınar, eski seçimi değil.
 */
export function overlayEntry(entry: SelectionEntry, row: BackupRow): SelectionEntry {
  const clone = (row.photo_prompt ?? {}) as { prompt?: string; prompt_sha1?: string };
  return {
    ...entry,
    bio: typeof row.bio === "string" ? row.bio : entry.bio,
    interests: Array.isArray(row.interests) ? (row.interests as SelectionEntry["interests"]) : entry.interests,
    age: typeof row.age === "number" ? row.age : entry.age,
    gender: row.gender === "WOMAN" || row.gender === "MAN" ? row.gender : entry.gender,
    district: typeof row.city === "string" ? row.city : entry.district,
    prompt: clone.prompt ?? entry.prompt,
    prompt_sha1: clone.prompt_sha1 ?? entry.prompt_sha1,
  };
}

function chunks<T>(arr: readonly T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function existingIds(client: SeedClient, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunks(ids)) {
    const { data, error } = await client.from("users").select("id").in("id", part);
    if (error) throw new Error(`users select: ${error.message}`);
    for (const r of (data ?? []) as { id: string }[]) found.add(r.id);
  }
  return found;
}

/** Geri yüklemeye özgü kontroller (verifySeedProfile'ın kapsamadıkları): persona, e-posta kapalı, soru sayacı. */
async function restoreChecks(client: SeedClient, id: string): Promise<VerifyCheck[]> {
  const { data, error } = await client.from("users")
    .select("seed_persona, email_notifications_enabled, question_count, is_seed_profile, is_test_account").eq("id", id).maybeSingle();
  if (error || !data) return [{ name: "geri_yukleme_satiri", ok: false, detail: error?.message ?? "satır yok" }];
  const persona = data.seed_persona as Record<string, unknown> | null;
  return [
    { name: "bot_kapisi", ok: data.is_seed_profile === true && data.is_test_account === true },
    { name: "persona_dolu", ok: !!persona && Object.keys(persona).length > 0 },
    { name: "eposta_kapali", ok: data.email_notifications_enabled === false },
    { name: "question_count_3", ok: data.question_count === QUESTIONS_PER_PROFILE, detail: `question_count=${data.question_count}` },
  ];
}

export interface RestoreOptions {
  apply: boolean;
  only?: Set<string>;
  exclude?: Set<string>;
  /** seed_id → seçim kaydı (tr-selection.json). */
  selection: Map<string, SelectionEntry>;
  bank: BankQuestion[];
  head: HeadFn;
}

export async function restoreFromBackup(client: SeedClient, opts: RestoreOptions): Promise<RestoreReport> {
  let rows: BackupRow[];
  try {
    rows = await fetchAll<BackupRow>((from, to) => client.from(BACKUP_TABLE).select("*").order("id").range(from, to));
  } catch (err) {
    throw new Error(`${BACKUP_TABLE} okunamadı: ${(err as { message?: string })?.message ?? String(err)}`);
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items: RestoreItem[] = [];
  const err = (id: string, seedId: string | null, message: string) => items.push({ id, seed_id: seedId, status: "error", message, warnings: [] });

  if (opts.only) for (const id of opts.only) if (!byId.has(id)) err(id, null, "yedekte yok");
  let candidates = opts.only ? rows.filter((r) => opts.only!.has(r.id)) : rows;
  const before = candidates.length;
  if (opts.exclude) candidates = candidates.filter((r) => !opts.exclude!.has(r.id));
  const excluded = before - candidates.length;

  const existing = await existingIds(client, candidates.map((r) => r.id));

  for (const row of candidates) {
    const seed = parseSeedEmail(row.email);
    const seedId = seed?.prefix === CFG.keyPrefix ? seed.seedId : null;
    if (!seedId || row.is_seed_profile !== true) { err(row.id, seedId, "TR seed satırı değil (e-posta deseni / is_seed_profile)"); continue; }
    const persona = row.seed_persona as Record<string, unknown> | null;
    if (!persona || Object.keys(persona).length === 0) { err(row.id, seedId, "seed_persona boş (bot cevap yazamaz)"); continue; }
    const sel = opts.selection.get(seedId);
    if (!sel) { err(row.id, seedId, "seçim kaydı yok (tr-selection.json)"); continue; }
    const entry = overlayEntry(sel, row);

    const questions = pickQuestions(opts.bank, entry, row.id, CFG);
    if (questions.length < QUESTIONS_PER_PROFILE) { err(row.id, seedId, `soru bankası yetersiz: ${questions.length}`); continue; }

    const item: RestoreItem = { id: row.id, seed_id: seedId, status: existing.has(row.id) ? "skipped" : "planned", warnings: [] };
    items.push(item);
    if (!opts.apply) continue;

    if (item.status === "planned") {
      const { error: userError } = await client.from("users").insert(buildRestoreUserRow(row)).select("id").single();
      if (userError) { item.status = "error"; item.message = `users: ${userError.message}`; continue; }
      item.status = "created";
      const { error: dErr } = await client.from("user_details").insert(buildDetailsRow(entry, row.id, CFG));
      if (dErr) item.warnings.push(`user_details: ${dErr.message}`);
      const langs = Array.isArray(row.preferred_languages) && row.preferred_languages.length ? row.preferred_languages : [CFG.locale];
      const { error: lErr } = await client.rpc("set_user_languages", { p_user_id: row.id, p_languages: langs });
      if (lErr) item.warnings.push(`set_user_languages: ${lErr.message}`);
      const { error: qErr } = await client.from("questions").insert(questions);
      if (qErr) item.warnings.push(`questions: ${qErr.message}`);
      else {
        // Prod'da trg_sync_user_question_count her soru için +1 yazar (satır 0 ile girdi → 3). Açık eşitleme tetikleyiciye
        // bağımlılığı kaldırır ve idempotenttir (tetikleyici zaten 3 yaptıysa yine 3).
        const { error: cErr } = await client.from("users").update({ question_count: questions.length }).eq("id", row.id).eq("is_seed_profile", true);
        if (cErr) item.warnings.push(`question_count: ${cErr.message}`);
      }
    }

    const replicateId = (row.photo_prompt as { replicate_id?: string | null } | null)?.replicate_id ?? null;
    const report = await verifySeedProfile(client, entry, opts.head, { replicate_id: replicateId, locale: CFG });
    const checks = [...report.checks, ...(await restoreChecks(client, row.id))];
    const failed = checks.filter((c) => !c.ok);
    item.verify = { ok: failed.length === 0, failed };
  }

  const tally: RestoreReport["tally"] = { planned: 0, created: 0, skipped: 0, error: 0, verified: 0, verify_failed: 0 };
  for (const it of items) {
    tally[it.status]++;
    if (it.verify) tally[it.verify.ok ? "verified" : "verify_failed"]++;
  }
  return { apply: opts.apply, backupRows: rows.length, excluded, candidates: candidates.length, items, tally };
}

async function headStatus(url: string): Promise<number> {
  const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
  return res.status;
}

async function main() {
  const args = parseRestoreArgs(process.argv.slice(2));
  const readIds = (path: string | undefined, label: string) => (path ? parseIdList(JSON.parse(readFileSync(path, "utf8")), label) : undefined);
  const only = readIds(args.only, "--only");
  const exclude = readIds(args.exclude, "--exclude");
  const { entries } = parseSelection(JSON.parse(readFileSync(seedDataPaths(CFG).selection, "utf8")), CFG);
  const selection = new Map(entries.map((e) => [e.seed_id, e]));

  const client = createSeedClient();
  const { data: bankRows, error: bankError } = await client.from("ai_question_bank")
    .select("question_text, answers, category, hint, target_gender").eq("locale", CFG.questionLocale).eq("is_active", true).limit(BANK_LIMIT);
  if (bankError) throw new Error(`ai_question_bank: ${bankError.message}`);
  const { bank } = parseBank(bankRows ?? []);

  const report = await restoreFromBackup(client, { apply: args.apply, only, exclude, selection, bank, head: headStatus });
  if (args.json) console.log(JSON.stringify(report));
  else {
    console.log(`${args.apply ? "UYGULA" : "KURU ÇALIŞTIRMA (yazma yok)"} · yedek ${report.backupRows} · dışlanan ${report.excluded} · aday ${report.candidates}`);
    for (const it of report.items) {
      const v = it.verify ? (it.verify.ok ? "doğrulandı ✓" : `DOĞRULAMA: ${it.verify.failed.map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ""}`).join(", ")}`) : "";
      console.log(`  ${it.seed_id ?? "-"} ${it.id} → ${it.status}${it.message ? ` (${it.message})` : ""}${it.warnings.length ? ` uyarı: ${it.warnings.join(" | ")}` : ""} ${v}`);
    }
    console.log(`özet: ${JSON.stringify(report.tally)}`);
  }
  if (report.tally.error || report.tally.verify_failed) process.exitCode = EXIT_FAILED;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`❌ ${e instanceof Error ? e.message : e}`); process.exitCode = 1; });
}
