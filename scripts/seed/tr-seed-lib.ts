/**
 * TR seed (test) profilleri — Stage 2 çekirdeği. CLI'lar: seed-tr-test-profiles.ts, delete-tr-test-profiles.ts
 *
 * Girdi: seed-profiles/tr-selection.json kaydı (tools/seed_prepare.py çıktısı: ilçe/il, final prompt + sha1,
 *        zenginleştirme: bio/meslek/ilgi/kişilik/evcil/sigara/alkol) + Stage 1 fotoğrafı (bytes + manifest meta).
 * Çıktı: users (+ photo_prompt klonu) + user_details + user_languages (RPC) + 3 soru + Storage `photos/seed/…`.
 *
 * Görünürlük: is_test_account=true → discover'da yalnız is_test_admin görür (matching.service.ts);
 * is_seed_profile=true → toplu silme işareti (057) ve login reddi (auth.service.ts).
 * users.city ilçe taşır (gerçek kullanıcılarda da ters geocode ilçe verir: Esenyurt, Konak…);
 * prompt'taki "Location: <ilçe>, <il>, Türkiye." cümlesi ile birebir aynı ilçe.
 * Tüm rastgele seçimler seed_id'den türetilir: aynı kayıt tekrar basılırsa aynı kişi çıkar.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { INTEREST_POOL } from "../../src/constants/interest-pool.js";
import { FEMALE_NAMES, MALE_NAMES, SURNAMES, ZODIACS } from "./data/tr-names.js";

/** Kullanılan yüzey; gerçek `createClient` sonucu ve tests/helpers/fake-supabase ikisi de uyar. */
export type SeedClient = Pick<SupabaseClient, "from" | "storage" | "rpc">;

export const SEED_EMAIL_DOMAIN = "@qulo.seed";
export const PHOTO_BUCKET = "photos";
export const SEED_STORAGE_PREFIX = "seed";
export const SEED_PHOTO_CONTENT_TYPE = "image/jpeg";
export const LOCALE = "tr";
export const QUESTIONS_PER_PROFILE = 3;
export const PERSONALITIES = ["İçe dönük", "Dışa dönük", "Ambivert"] as const;
export const FREQUENCIES = ["YES", "NO", "SOMETIMES"] as const;
const COUNTRY = "Türkiye";
/** Türkiye sınır kutusu (kabaca) — ilçe koordinatları bunun içinde olmalı. */
const TR_BBOX = { latMin: 35.8, latMax: 42.2, lngMin: 25.6, lngMax: 45.0 };
const REFERRAL_LENGTH = 8; // users.referral_code VARCHAR(8)
const BASE36 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const HOURS_72_MS = 72 * 3600 * 1000;
const AGE_PREF_CAP = 60;
const STORAGE_PAGE = 100;
const HTTP_OK = 200;
/** Silinecek dosya adı deseni — gerçek kullanıcı yolları `<uuid>/<ts>.jpg`, bu desene asla uymaz. */
const SEED_FILE_RE = /^tr_\d{4}\.jpg$/;

export const sha1 = (text: string) => createHash("sha1").update(text, "utf8").digest("hex");
/** tools/seed_prepare.py `location_sentence` ile birebir aynı biçim. */
export const locationSentence = (district: string, province: string) => `Location: ${district}, ${province}, Türkiye.`;

// --- girdi şemaları ---------------------------------------------------------------------

const frequency = z.enum(FREQUENCIES);

export const selectionEntrySchema = z
  .object({
    seed_id: z.string().regex(/^seed_\d{4}$/),
    gender: z.enum(["WOMAN", "MAN"]),
    age: z.number().int().min(18).max(55),
    prompt: z.string().min(1),
    prompt_sha1: z.string().regex(/^[0-9a-f]{40}$/),
    relationship_goal: z.enum(["SERIOUS", "FRIENDSHIP", "NOT_SURE"]),
    bio: z.string().trim().min(20).max(300),
    interests: z.array(z.enum(INTEREST_POOL)).min(3).max(5), // tools/seed_prepare.py sözleşmesiyle aynı
    height: z.number().int().min(140).max(210).nullable(),
    province: z.string().trim().min(1),
    district: z.string().trim().min(1),
    lat: z.number().min(TR_BBOX.latMin).max(TR_BBOX.latMax), // ters (lng, lat) yazımı yakalanır
    lng: z.number().min(TR_BBOX.lngMin).max(TR_BBOX.lngMax),
    job: z.string().trim().min(2).max(40),
    personality: z.enum(PERSONALITIES),
    pets: z.string().trim().min(1).max(40).nullable().optional(),
    music_type: z.string().trim().min(1).max(40).nullable().optional(),
    smoking: frequency,
    alcohol: frequency,
    selected: z.literal(true),
  })
  .superRefine((e, ctx) => {
    // Kontrol listesi (spec): prompt'taki bölge = profildeki bölge, yaş birebir, klon sha1 tutarlı.
    if (!e.prompt.includes(locationSentence(e.district, e.province))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["prompt"], message: "konum cümlesi ilçe/il ile eşleşmiyor" });
    }
    if (!e.prompt.includes(`${e.age}-year-old`)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["prompt"], message: "yaş etiketi profil yaşıyla eşleşmiyor" });
    }
    if (sha1(e.prompt) !== e.prompt_sha1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["prompt_sha1"], message: "prompt_sha1 prompt ile eşleşmiyor" });
    }
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

/** tr-selection.json → yalnız `selected=true` ve şemaya uyan kayıtlar; uymayanlar seed_id + ilk hata ile raporlanır. */
export function parseSelection(raw: unknown): { entries: SelectionEntry[]; invalid: { seed_id: string; reason: string }[] } {
  const profiles = z.object({ profiles: z.array(z.record(z.unknown())) }).parse(raw).profiles;
  const entries: SelectionEntry[] = [];
  const invalid: { seed_id: string; reason: string }[] = [];
  for (const p of profiles) {
    if (p.selected !== true) continue;
    const parsed = selectionEntrySchema.safeParse(p);
    if (parsed.success) entries.push(parsed.data);
    else {
      const first = parsed.error.issues[0];
      invalid.push({ seed_id: String(p.seed_id ?? "?"), reason: `${first?.path.join(".")}: ${first?.message}` });
    }
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

/** Stage 1 manifest kaydı (seed-profiles/photos-manifest.json) — üretim meta verisi photo_prompt klonuna girer. */
export const photoMetaSchema = z.object({
  model: z.string().min(1),
  prompt_sha1: z.string().regex(/^[0-9a-f]{40}$/),
  generated_at: z.string().min(1),
  replicate_id: z.string().nullable().optional(),
  input: z.record(z.unknown()).nullable().optional(),
});
export type PhotoMeta = z.infer<typeof photoMetaSchema>;

export interface SeedPhoto {
  bytes: Uint8Array;
  contentType: string;
  meta: PhotoMeta;
}

export type SeedResult =
  | { status: "skipped"; email: string; id: string }
  | { status: "created"; email: string; id: string; warnings: string[] }
  | { status: "error"; email: string; step: "exists" | "photo" | "upload" | "users"; message: string };

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

/** users.photo_prompt (058): prompt'un birebir klonu + üretim meta verisi. */
export function buildPhotoPrompt(entry: SelectionEntry, meta: PhotoMeta) {
  return {
    prompt: entry.prompt,
    prompt_sha1: entry.prompt_sha1,
    model: meta.model,
    replicate_id: meta.replicate_id ?? null,
    input: meta.input ?? null,
    generated_at: meta.generated_at,
    seed_id: entry.seed_id,
    province: entry.province,
    district: entry.district,
  };
}

export function buildUserRow(entry: SelectionEntry, photoUrl: string, photoMeta: PhotoMeta, passwordHash: string, now: Date) {
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
    bio: entry.bio,
    city: entry.district,
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
    photo_prompt: buildPhotoPrompt(entry, photoMeta),
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
    job: entry.job,
    smoking: entry.smoking,
    alcohol: entry.alcohol,
    personality: entry.personality,
    pets: entry.pets ?? null,
    music_type: entry.music_type ?? null,
  };
}

/** Bankadan cinsiyete uygun (target_gender boş ya da eşleşen) 3 farklı soru; banka kısa ise daha az döner. */
export function pickQuestions(bank: BankQuestion[], entry: SelectionEntry, userId: string) {
  const rng = makeRng("questions:" + entry.seed_id);
  const target = entry.gender === "WOMAN" ? "female" : "male";
  // DB select sırası tanımsız → metne göre sırala ki aynı seed hep aynı 3 soruyu alsın (determinizm sözü)
  const eligible = bank.filter((q) => !q.target_gender || q.target_gender === target)
    .sort((a, b) => (a.question_text < b.question_text ? -1 : a.question_text > b.question_text ? 1 : 0));
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

/**
 * Tek profili basar. İdempotent: e-posta varsa `skipped`.
 * Sıra: foto/prompt tutarlılığı → Storage upload → users insert → (user_details, diller RPC, sorular).
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
  if (photo.meta.prompt_sha1 !== entry.prompt_sha1) {
    // Fotoğraf eski prompt'tan üretilmiş: klon alanı fotoğrafı üreten prompt olmaz → basma.
    return { status: "error", email, step: "photo", message: `fotoğraf prompt sha1 ${photo.meta.prompt_sha1.slice(0, 8)} ≠ seçim ${entry.prompt_sha1.slice(0, 8)}` };
  }
  const { data: existing, error: existsError } = await client
    .from("users").select("id").eq("email", email).maybeSingle();
  if (existsError) return { status: "error", email, step: "exists", message: existsError.message };
  if (existing) return { status: "skipped", email, id: existing.id };

  const path = storagePath(entry.seed_id);
  const bucket = client.storage.from(PHOTO_BUCKET);
  // upsert: aynı yol yeniden basımda (silme → yeniden) ya da yarım koşudan kalan dosyada yeni fotoğrafı taşımalı.
  const { error: uploadError } = await bucket.upload(path, photo.bytes, { contentType: photo.contentType, upsert: true });
  if (uploadError) return { status: "error", email, step: "upload", message: uploadError.message };
  const photoUrl: string = bucket.getPublicUrl(path).data.publicUrl;

  const userRow = buildUserRow(entry, photoUrl, photo.meta, opts.passwordHash, opts.now ?? new Date());
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

// --- akış: doğrulama (kayıt sonrası kontrol listesi) ---------------------------------------

export interface VerifyCheck { name: string; ok: boolean; detail?: string }
export interface VerifyReport { ok: boolean; id: string | null; checks: VerifyCheck[] }
/** URL'ye HEAD atıp HTTP durum kodunu döner (CLI: fetch; test: sahte). */
export type HeadFn = (url: string) => Promise<number>;

const USER_VERIFY_COLUMNS = "id, age, gender, city, photos, photo_prompt, bio, interests, preferred_languages, is_test_account, is_seed_profile";

/**
 * Canlı kayıt, seçim kaydıyla alan alan karşılaştırılır; her madde spec'teki kontrol listesinin bir satırı.
 * Fotoğraf URL'si gerçekten servis ediliyor mu (HEAD 200), prompt klonu bire bir mi, 3 soru ve detay satırı var mı.
 */
export async function verifySeedProfile(client: SeedClient, entry: SelectionEntry, head: HeadFn): Promise<VerifyReport> {
  const email = seedEmail(entry.seed_id);
  const checks: VerifyCheck[] = [];
  const add = (name: string, ok: boolean, detail?: string) => checks.push(detail === undefined ? { name, ok } : { name, ok, detail });

  const { data: user, error } = await client.from("users").select(USER_VERIFY_COLUMNS).eq("email", email).maybeSingle();
  if (error || !user) {
    add("kayit_var", false, error?.message ?? "users satırı yok");
    return { ok: false, id: null, checks };
  }
  add("kayit_var", true);
  add("is_seed", user.is_seed_profile === true && user.is_test_account === true, `is_seed_profile=${user.is_seed_profile} is_test_account=${user.is_test_account}`);
  add("ilce_il", user.city === entry.district, `city=${user.city} beklenen=${entry.district}`);
  add("yas_cinsiyet", user.age === entry.age && user.gender === entry.gender, `${user.gender} ${user.age}`);
  add("bio_ilgi", user.bio === entry.bio && JSON.stringify(user.interests) === JSON.stringify(entry.interests),
    user.bio === entry.bio ? `interests=${JSON.stringify(user.interests)}` : "bio farklı");

  const photoUrl: string | undefined = user.photos?.[0];
  let status = 0;
  if (photoUrl) {
    try { status = await head(photoUrl); } catch (err) { status = -1; add("foto_head", false, err instanceof Error ? err.message : String(err)); }
  }
  if (status !== -1) add("foto_url_200", status === HTTP_OK, `${photoUrl ?? "(foto yok)"} → ${status}`);

  const clone = user.photo_prompt as { prompt?: string; prompt_sha1?: string } | null;
  add("prompt_klonu", clone?.prompt === entry.prompt && clone?.prompt_sha1 === entry.prompt_sha1,
    clone ? `sha1 ${clone.prompt_sha1?.slice(0, 8)}` : "photo_prompt boş");
  add("dil_tr", Array.isArray(user.preferred_languages) && user.preferred_languages.includes(LOCALE));

  const { data: qs, error: qErr } = await client.from("questions").select("id").eq("user_id", user.id);
  add("soru_3", !qErr && (qs?.length ?? 0) === QUESTIONS_PER_PROFILE, qErr ? qErr.message : `${qs?.length ?? 0} soru`);

  const { data: details, error: dErr } = await client.from("user_details").select("job").eq("user_id", user.id).maybeSingle();
  add("detay_meslek", !dErr && details?.job === entry.job, dErr ? dErr.message : `job=${details?.job ?? "(yok)"}`);

  return { ok: checks.every((c) => c.ok), id: user.id, checks };
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
    .from("users").select("id").eq("is_seed_profile", true).like("email", `%${SEED_EMAIL_DOMAIN}`);
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
