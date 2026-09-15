/**
 * TR seed (test) profilleri — Stage 2 çekirdeği. CLI'lar: seed-tr-test-profiles.ts, delete-tr-test-profiles.ts
 *
 * Girdi: seed-profiles/tr-selection.json kaydı + Stage 1 fotoğrafı (bytes).
 * Çıktı: users + user_details + user_languages (RPC) + 3 soru + Storage `photos/seed/…`.
 *
 * Görünürlük: is_test_account=true → discover'da yalnız is_test_admin görür (matching.service.ts);
 * is_seed_profile=true → toplu silme işareti (057) ve login reddi (auth.service.ts).
 * Tüm rastgele seçimler seed_id'den türetilir: aynı kayıt tekrar basılırsa aynı kişi çıkar.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { BIOS, FEMALE_NAMES, JOBS, MALE_NAMES, PERSONALITIES, SURNAMES, ZODIACS } from "./data/tr-names.js";

/** Kullanılan yüzey; gerçek `createClient` sonucu ve tests/helpers/fake-supabase ikisi de uyar. */
export type SeedClient = Pick<SupabaseClient, "from" | "storage" | "rpc">;

export const SEED_EMAIL_DOMAIN = "@qulo.seed";
export const PHOTO_BUCKET = "photos";
export const SEED_STORAGE_PREFIX = "seed";
export const SEED_PHOTO_CONTENT_TYPE = "image/jpeg";
export const LOCALE = "tr";
export const QUESTIONS_PER_PROFILE = 3;
const COUNTRY = "Türkiye";
const REFERRAL_LENGTH = 8; // users.referral_code VARCHAR(8)
const BASE36 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const HOURS_72_MS = 72 * 3600 * 1000;
const AGE_PREF_CAP = 60;
const STORAGE_PAGE = 100;
/** Silinecek dosya adı deseni — gerçek kullanıcı yolları `<uuid>/<ts>.jpg`, bu desene asla uymaz. */
const SEED_FILE_RE = /^tr_\d{4}\.jpg$/;

// --- girdi şemaları ---------------------------------------------------------------------

export const selectionEntrySchema = z.object({
  seed_id: z.string().regex(/^seed_\d{4}$/),
  gender: z.enum(["WOMAN", "MAN"]),
  age: z.number().int().min(18).max(55),
  prompt: z.string().min(1),
  relationship_goal: z.enum(["SERIOUS", "FRIENDSHIP", "NOT_SURE"]),
  bio: z.string().nullable(),
  interests: z.array(z.string()),
  height: z.number().int().nullable(),
  city: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  selected: z.literal(true),
});
export type SelectionEntry = z.infer<typeof selectionEntrySchema>;

export const bankQuestionSchema = z.object({
  question_text: z.string().min(1),
  answers: z.array(z.string().min(1)).length(4),
  category: z.string().nullable(),
  hint: z.string().nullable(),
  target_gender: z.enum(["male", "female"]).nullable(),
});
export type BankQuestion = z.infer<typeof bankQuestionSchema>;

/** tr-selection.json → yalnız `selected=true` ve şemaya uyan kayıtlar; uymayanlar seed_id ile raporlanır. */
export function parseSelection(raw: unknown): { entries: SelectionEntry[]; invalid: string[] } {
  const profiles = z.object({ profiles: z.array(z.record(z.unknown())) }).parse(raw).profiles;
  const entries: SelectionEntry[] = [];
  const invalid: string[] = [];
  for (const p of profiles) {
    if (p.selected !== true) continue;
    const parsed = selectionEntrySchema.safeParse(p);
    if (parsed.success) entries.push(parsed.data);
    else invalid.push(String(p.seed_id ?? "?"));
  }
  return { entries, invalid };
}

/** ai_question_bank satırları → 4 metin cevaplı sorular; diğerleri sayılıp atılır. */
export function parseBank(rows: unknown[]): { bank: BankQuestion[]; dropped: number } {
  const bank: BankQuestion[] = [];
  let dropped = 0;
  for (const row of rows) {
    const parsed = bankQuestionSchema.safeParse(row);
    if (parsed.success) bank.push(parsed.data);
    else dropped++;
  }
  return { bank, dropped };
}

export interface SeedPhoto {
  bytes: Uint8Array;
  contentType: string;
}

export type SeedResult =
  | { status: "skipped"; email: string; id: string }
  | { status: "created"; email: string; id: string; warnings: string[] }
  | { status: "error"; email: string; step: "exists" | "upload" | "users"; message: string };

// --- deterministik RNG (FNV-1a tohum + mulberry32) -------------------------------------

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function makeRng(seedText: string): () => number {
  let a = fnv1a(seedText);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
const randInt = (rng: () => number, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const weighted = <T extends string>(rng: () => number, table: Record<T, number>): T => {
  const total = Object.values<number>(table).reduce((s, w) => s + w, 0);
  let r = rng() * total;
  for (const [key, w] of Object.entries<number>(table)) {
    if ((r -= w) < 0) return key as T;
  }
  return Object.keys(table)[0] as T;
};
/** Fisher-Yates — `sort(() => rng() - 0.5)` tutarsız karşılaştırıcıdır, üniform değildir. */
function shuffle<T>(rng: () => number, arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// --- saf builder'lar ------------------------------------------------------------------

const seedNumber = (seedId: string) => seedId.replace(/^seed_/, "");

export function seedEmail(seedId: string): string {
  return `seed-tr_${seedNumber(seedId)}${SEED_EMAIL_DOMAIN}`;
}

export function storagePath(seedId: string): string {
  return `${SEED_STORAGE_PREFIX}/tr_${seedNumber(seedId)}.jpg`;
}

/** 'S' + 7 base36 karakter, seed_id'den türetilir (8 karakter, kolon sınırı). */
export function referralCode(seedId: string): string {
  const rng = makeRng("referral:" + seedId);
  let code = "S";
  while (code.length < REFERRAL_LENGTH) code += BASE36[Math.floor(rng() * BASE36.length)];
  return code;
}

export function buildUserRow(entry: SelectionEntry, photoUrl: string, passwordHash: string, now: Date) {
  const rng = makeRng("user:" + entry.seed_id);
  const isWoman = entry.gender === "WOMAN";
  const prefMin = Math.max(18, entry.age - randInt(rng, 3, 6));
  const prefMax = Math.max(entry.age + 1, Math.min(AGE_PREF_CAP, entry.age + randInt(rng, 3, 8)));
  return {
    email: seedEmail(entry.seed_id),
    password_hash: passwordHash,
    name: pick(rng, isWoman ? FEMALE_NAMES : MALE_NAMES),
    surname: pick(rng, SURNAMES),
    age: entry.age,
    gender: entry.gender,
    gender_pref: isWoman ? "MAN" : "WOMAN",
    bio: entry.bio ?? pick(rng, BIOS[entry.gender]),
    city: entry.city,
    country: COUNTRY,
    lat: entry.lat,
    lng: entry.lng,
    locale: LOCALE,
    match_radius_km: randInt(rng, 25, 100),
    age_pref_min: prefMin,
    age_pref_max: prefMax,
    relationship_goal: entry.relationship_goal,
    email_verified: true,
    is_online: false,
    profile_completion: randInt(rng, 78, 92),
    green_diamonds: randInt(rng, 10, 40),
    preferred_languages: [LOCALE],
    interests: entry.interests,
    photos: [photoUrl],
    referral_code: referralCode(entry.seed_id),
    last_seen_at: new Date(now.getTime() - Math.floor(rng() * HOURS_72_MS)).toISOString(),
    is_test_account: true,
    is_seed_profile: true,
  };
}

export function buildDetailsRow(entry: SelectionEntry, userId: string) {
  const rng = makeRng("details:" + entry.seed_id);
  const [hMin, hMax] = entry.gender === "WOMAN" ? [155, 178] : [168, 192];
  return {
    user_id: userId,
    height: entry.height ?? randInt(rng, hMin, hMax),
    zodiac: pick(rng, ZODIACS),
    job: pick(rng, JOBS),
    smoking: weighted(rng, { NO: 60, SOMETIMES: 30, YES: 10 }),
    alcohol: weighted(rng, { SOMETIMES: 50, NO: 35, YES: 15 }),
    personality: pick(rng, PERSONALITIES),
  };
}

/** Bankadan cinsiyete uygun (target_gender boş ya da eşleşen) 3 farklı soru; banka kısa ise daha az döner. */
export function pickQuestions(bank: BankQuestion[], entry: SelectionEntry, userId: string) {
  const rng = makeRng("questions:" + entry.seed_id);
  const target = entry.gender === "WOMAN" ? "female" : "male";
  const eligible = bank.filter((q) => !q.target_gender || q.target_gender === target);
  return shuffle(rng, eligible).slice(0, QUESTIONS_PER_PROFILE).map((q, i) => ({
    user_id: userId,
    order_num: i + 1,
    question_text: q.question_text,
    answer_1: q.answers[0],
    answer_2: q.answers[1],
    answer_3: q.answers[2],
    answer_4: q.answers[3],
    correct_answer: randInt(rng, 1, 4),
    hint_text: q.hint,
    category: q.category,
    time_limit: 30,
    locale: LOCALE,
  }));
}

// --- akış: basma ----------------------------------------------------------------------

const isAlreadyExists = (err: { message?: string; statusCode?: string | number }) =>
  String(err.statusCode ?? "") === "409" || /already exists/i.test(err.message ?? "");

/**
 * Tek profili basar. İdempotent: e-posta varsa `skipped`.
 * Sıra: Storage upload → users insert → (user_details, diller RPC, sorular).
 * Son üçlü transaction'sız; hata `warnings` olarak döner, kullanıcı silinmez
 * (deleteSeedProfiles toplu temizler).
 */
export async function seedProfile(
  client: SeedClient,
  entry: SelectionEntry,
  photo: SeedPhoto,
  bank: BankQuestion[],
  opts: { passwordHash: string; now?: Date },
): Promise<SeedResult> {
  const email = seedEmail(entry.seed_id);
  const { data: existing, error: existsError } = await client
    .from("users").select("id").eq("email", email).maybeSingle();
  if (existsError) return { status: "error", email, step: "exists", message: existsError.message };
  if (existing) return { status: "skipped", email, id: existing.id };

  const path = storagePath(entry.seed_id);
  const bucket = client.storage.from(PHOTO_BUCKET);
  // upsert yok: yol deterministik; önceki yarım koşudan kalan dosya "already exists" ile tolere edilir.
  const { error: uploadError } = await bucket.upload(path, photo.bytes, { contentType: photo.contentType, upsert: false });
  if (uploadError && !isAlreadyExists(uploadError)) {
    return { status: "error", email, step: "upload", message: uploadError.message };
  }
  const photoUrl: string = bucket.getPublicUrl(path).data.publicUrl;

  const userRow = buildUserRow(entry, photoUrl, opts.passwordHash, opts.now ?? new Date());
  const { data: inserted, error: userError } = await client.from("users").insert(userRow).select("id").single();
  if (userError || !inserted) return { status: "error", email, step: "users", message: userError?.message ?? "insert boş döndü" };

  const warnings: string[] = [];
  const { error: detailsError } = await client.from("user_details").insert(buildDetailsRow(entry, inserted.id));
  if (detailsError) warnings.push(`user_details: ${detailsError.message}`);

  // user_languages'a doğrudan yazma: 054 sonrası tek kaynak users.preferred_languages, türev tablo RPC ile.
  const { error: langError } = await client.rpc("set_user_languages", { p_user_id: inserted.id, p_languages: [LOCALE] });
  if (langError) warnings.push(`set_user_languages: ${langError.message}`);

  const questions = pickQuestions(bank, entry, inserted.id);
  if (questions.length < QUESTIONS_PER_PROFILE) warnings.push(`soru bankası yetersiz: ${questions.length}`);
  if (questions.length > 0) {
    const { error: qError } = await client.from("questions").insert(questions);
    if (qError) warnings.push(`questions: ${qError.message}`);
  }

  return { status: "created", email, id: inserted.id, warnings };
}

// --- akış: silme ----------------------------------------------------------------------

export interface DeleteReport {
  dryRun: boolean;
  users: number;
  files: number;
  deletedUsers: number;
  removedFiles: number;
  warnings: string[];
}

async function listSeedFiles(client: SeedClient): Promise<string[]> {
  const bucket = client.storage.from(PHOTO_BUCKET);
  const all: string[] = [];
  for (let offset = 0; ; offset += STORAGE_PAGE) {
    const { data, error } = await bucket.list(SEED_STORAGE_PREFIX, { limit: STORAGE_PAGE, offset });
    if (error) throw new Error(`storage list: ${error.message}`);
    const page = data ?? [];
    all.push(...page.filter((f) => SEED_FILE_RE.test(f.name)).map((f) => `${SEED_STORAGE_PREFIX}/${f.name}`));
    if (page.length < STORAGE_PAGE) return all;
  }
}

/**
 * is_seed_profile=true AND *@qulo.seed kullanıcılarını siler (bağlı tablolar FK CASCADE)
 * ve `photos/seed/tr_NNNN.jpg` dosyalarını kaldırır. `confirm=false` yalnız sayar.
 */
export async function deleteSeedProfiles(client: SeedClient, opts: { confirm: boolean }): Promise<DeleteReport> {
  const { data: users, error } = await client
    .from("users").select("id, email").eq("is_seed_profile", true).like("email", `%${SEED_EMAIL_DOMAIN}`);
  if (error) throw new Error(`users select: ${error.message}`);
  const files = await listSeedFiles(client);
  const report: DeleteReport = { dryRun: !opts.confirm, users: users?.length ?? 0, files: files.length, deletedUsers: 0, removedFiles: 0, warnings: [] };
  if (!opts.confirm) return report;

  const { count, error: delError } = await client
    .from("users").delete({ count: "exact" }).eq("is_seed_profile", true).like("email", `%${SEED_EMAIL_DOMAIN}`);
  if (delError) throw new Error(`users delete: ${delError.message}`);
  report.deletedUsers = count ?? 0;

  for (let i = 0; i < files.length; i += STORAGE_PAGE) {
    const chunk = files.slice(i, i + STORAGE_PAGE);
    const { error: rmError } = await client.storage.from(PHOTO_BUCKET).remove(chunk);
    if (rmError) report.warnings.push(`storage remove (${chunk[0]}…): ${rmError.message}`);
    else report.removedFiles += chunk.length;
  }
  return report;
}
