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
const COUNTRY = "TR"; // ISO 3166-1 alpha-2 (migration 062) — updateLocation ve FormatManager aynı biçim
/** Türkiye sınır kutusu (kabaca) — ilçe koordinatları bunun içinde olmalı. */
const TR_BBOX = { latMin: 35.8, latMax: 42.2, lngMin: 25.6, lngMax: 45.0 };
const REFERRAL_LENGTH = 8; // users.referral_code VARCHAR(8)
const BASE36 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const HOURS_72_MS = 72 * 3600 * 1000;
const AGE_PREF_CAP = 60;
const STORAGE_PAGE = 100;
const HTTP_OK = 200;
/** Silinecek dosya adı deseni — gerçek kullanıcı yolları `<uuid>/<ts>.jpg`, bu desene asla uymaz. */
const SEED_FILE_RE = /^tr_\d{4}(?:_[a-z0-9]{1,32})?\.jpg$/;
const PUBLIC_PATH_MARK = `/storage/v1/object/public/${PHOTO_BUCKET}/`;

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
/** Gerçekçilik düzenlemesi: taban görsel referans verilip aynı kişiyle yeniden üretildi (tools/seed_realism.py). */
export const photoEditSchema = z.object({
  kind: z.literal("realism"),
  version: z.number().int().positive(),
  prompt: z.string().min(1),
  reference_replicate_id: z.string().min(1),
  /** Düzenleme çağrısının seed'i (null = seed'siz, birebir yeniden üretilemez — v3 ilk parti). */
  seed: z.number().int().nullable().optional(),
  /** Referans görselin kendi üretim girdisi (seed dahil) — Replicate girdileri 1 saat sonra siler, zincir burada kalır. */
  reference_input: z.record(z.unknown()).nullable().optional(),
});
export type PhotoEdit = z.infer<typeof photoEditSchema>;

/** Telefon son işlemi (tools/seed_postprocess.py): parametreler seed_id'den deterministik → klondan yeniden üretilebilir. */
export const photoPostSchema = z.object({
  kind: z.literal("phone"),
  version: z.number().int().positive(),
  /** v1 ekseni — eski manifest kayıtlarında duruyor, yeni üretimde yazılmaz. */
  level: z.enum(["medium", "heavy"]).optional(),
  /** v2 çekim karakteri (temiz/gunluk/eski_telefon/dusuk_isik/flas/ekran_goruntusu/whatsapp). */
  karakter: z.string().min(1).optional(),
  /** v3 yöntem ailesi (kadraj/hdr_telefon/portre_modu/pus_parlama/kromatik/ham_temiz/eski_kamera + v2 devralınanlar). */
  yontem: z.string().min(1).optional(),
  /** v3 kırpma düzeltmesi: ham görselde (x0, y0, x1, y1) — AI denetiminde kusurlu bant kadraj dışına alındı. */
  crop_fix: z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()]).optional(),
}).passthrough().refine((p) => p.level !== undefined || p.karakter !== undefined || p.yontem !== undefined, {
  message: "post: v1 'level', v2 'karakter' ya da v3 'yontem' alanlarından biri bulunmalı",
});

export const photoMetaSchema = z.object({
  model: z.string().min(1),
  prompt_sha1: z.string().regex(/^[0-9a-f]{40}$/),
  generated_at: z.string().min(1),
  replicate_id: z.string().nullable().optional(),
  input: z.record(z.unknown()).nullable().optional(),
  edit: photoEditSchema.nullable().optional(),
  post: photoPostSchema.nullable().optional(),
});
export type PhotoMeta = z.infer<typeof photoMetaSchema>;

export interface SeedPhoto {
  bytes: Uint8Array;
  contentType: string;
  meta: PhotoMeta;
  /** `meta.edit` varsa ZORUNLU: düzenlemenin referans görseli — Storage'a yüklenir, yolu klona yazılır. */
  reference?: { bytes: Uint8Array; contentType: string } | null;
}

export type SeedResult =
  | { status: "skipped"; email: string; id: string }
  | { status: "created"; email: string; id: string; warnings: string[] }
  | { status: "error"; email: string; step: "exists" | "photo" | "upload" | "users"; message: string };

export type ReplaceResult =
  | { status: "unchanged"; email: string; id: string }
  | { status: "replaced"; email: string; id: string; photoUrl: string; warnings: string[]; orphans: string[] }
  | { status: "error"; email: string; step: "photo" | "exists" | "upload" | "update"; message: string };

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

/** `tag` = görsel kimliği (replicate_id'den): aynı profilde yeni görsel yeni yol alır → önbellekte eski görsel kalmaz. */
export function storagePath(seedId: string, tag?: string): string {
  return `${SEED_STORAGE_PREFIX}/tr_${seedNumber(seedId)}${tag ? `_${tag}` : ""}.jpg`;
}

/** replicate_id → yol etiketi (küçük harf alfanümerik, en fazla 12). */
export function photoTag(replicateId: string | null | undefined): string | undefined {
  const tag = (replicateId ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  return tag || undefined;
}

/** 'S' + 7 base36 karakter, seed_id'den türetilir (8 karakter, kolon sınırı). */
export function referralCode(seedId: string): string {
  const rng = makeRng("referral:" + seedId);
  let code = "S";
  while (code.length < REFERRAL_LENGTH) code += BASE36[Math.floor(rng() * BASE36.length)];
  return code;
}

/**
 * users.photo_prompt (058): fotoğrafı üreten zincirin birebir klonu. `prompt` taban (kişi) prompt'u;
 * `edit` varsa fotoğraf, `reference_replicate_id` görseli referans verilerek `edit.prompt` ile yeniden üretildi.
 */
export function buildPhotoPrompt(entry: SelectionEntry, meta: PhotoMeta, referencePath: string | null = null) {
  return {
    prompt: entry.prompt,
    prompt_sha1: entry.prompt_sha1,
    model: meta.model,
    replicate_id: meta.replicate_id ?? null,
    input: meta.input ?? null,
    generated_at: meta.generated_at,
    edit: meta.edit ? { ...meta.edit, reference_path: referencePath } : null,
    post: meta.post ?? null,
    seed_id: entry.seed_id,
    province: entry.province,
    district: entry.district,
  };
}

export function buildUserRow(
  entry: SelectionEntry, photoUrl: string, photoMeta: PhotoMeta, passwordHash: string, now: Date, referencePath: string | null = null,
) {
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
    photo_prompt: buildPhotoPrompt(entry, photoMeta, referencePath),
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

/** Düzenlenmiş görselin referansını etiketli yola yükler; `meta.edit` yoksa null. Referans baytı yoksa hata metni döner. */
async function uploadReference(
  bucket: ReturnType<SeedClient["storage"]["from"]>, entry: SelectionEntry, photo: SeedPhoto,
): Promise<{ path: string | null; error?: string }> {
  const edit = photo.meta.edit;
  if (!edit) return { path: null };
  if (!photo.reference) return { path: null, error: "düzenlenmiş görselin referansı yok (zincir korunamaz)" };
  const path = storagePath(entry.seed_id, photoTag(edit.reference_replicate_id));
  const { error } = await bucket.upload(path, photo.reference.bytes, { contentType: photo.reference.contentType, upsert: true });
  return error ? { path: null, error: `referans yüklenemedi: ${error.message}` } : { path };
}

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
  if (photo.meta.edit && !photo.reference) {
    return { status: "error", email, step: "photo", message: "düzenlenmiş görselin referansı yok (zincir korunamaz)" };
  }
  const { data: existing, error: existsError } = await client
    .from("users").select("id").eq("email", email).maybeSingle();
  if (existsError) return { status: "error", email, step: "exists", message: existsError.message };
  if (existing) return { status: "skipped", email, id: existing.id };

  const path = storagePath(entry.seed_id, photoTag(photo.meta.replicate_id));
  const bucket = client.storage.from(PHOTO_BUCKET);
  // upsert: yarım koşudan kalan aynı görsel (aynı etiket) engel olmasın.
  const { error: uploadError } = await bucket.upload(path, photo.bytes, { contentType: photo.contentType, upsert: true });
  if (uploadError) return { status: "error", email, step: "upload", message: uploadError.message };
  const photoUrl: string = bucket.getPublicUrl(path).data.publicUrl;
  const ref = await uploadReference(bucket, entry, photo);
  if (ref.error) return { status: "error", email, step: "upload", message: ref.error };

  const userRow = buildUserRow(entry, photoUrl, photo.meta, opts.passwordHash, opts.now ?? new Date(), ref.path);
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

// --- akış: fotoğrafı yerinde değiştir ----------------------------------------------------

/** Public URL → bucket içi yol (`seed/tr_0015_x.jpg`); başka bucket/URL ise null. */
function storagePathFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const i = url.indexOf(PUBLIC_PATH_MARK);
  if (i < 0) return null;
  try {
    return decodeURIComponent(url.slice(i + PUBLIC_PATH_MARK.length));
  } catch {
    return null; // bozuk yüzde kodlaması: yol çıkarılamadı → silme adayı değil
  }
}

/**
 * Basılmış seed profilinin fotoğrafını (görsel QA sonrası gerçekçilik düzenlemesi / yeniden üretim) değiştirir.
 * Kullanıcı satırı SİLİNMEZ: id, eşleşmeler, swipe'lar korunur. Yeni görsel yeni yola yüklenir, `photos` ve
 * `photo_prompt` klonu birlikte güncellenir, eski seed dosyası kaldırılır. Klondaki replicate_id zaten aynıysa `unchanged`.
 */
export async function replaceSeedPhoto(client: SeedClient, entry: SelectionEntry, photo: SeedPhoto): Promise<ReplaceResult> {
  const email = seedEmail(entry.seed_id);
  if (photo.meta.prompt_sha1 !== entry.prompt_sha1) {
    return { status: "error", email, step: "photo", message: `fotoğraf prompt sha1 ${photo.meta.prompt_sha1.slice(0, 8)} ≠ seçim ${entry.prompt_sha1.slice(0, 8)}` };
  }
  const { data: user, error } = await client
    .from("users").select("id, photos, photo_prompt").eq("email", email).eq("is_seed_profile", true).maybeSingle();
  if (error) return { status: "error", email, step: "exists", message: error.message };
  if (!user) return { status: "error", email, step: "exists", message: "seed profili yok (önce basılmalı)" };
  const currentPrompt = user.photo_prompt as { replicate_id?: string | null; post?: { version?: number } | null } | null;
  const currentId = currentPrompt?.replicate_id ?? null;
  // Aynı görsel + aynı son işlem sürümü ise dokunma. Sürüm farkı YENİDEN YÜKLEME sebebidir:
  // seed_postprocess v2 çekim karakteri havuzunu getirdi, v1'de tüm set tek banda ('medium')
  // düşmüştü — görsel aynı kalsa da dosyanın baytları değişir.
  const currentPostVersion = currentPrompt?.post?.version ?? null;
  const newPostVersion = photo.meta.post?.version ?? null;
  if (currentId && currentId === photo.meta.replicate_id && currentPostVersion === newPostVersion) {
    return { status: "unchanged", email, id: user.id };
  }
  const bucket = client.storage.from(PHOTO_BUCKET);
  const oldPath = storagePathFromUrl(user.photos?.[0]);
  const oldName = oldPath?.startsWith(`${SEED_STORAGE_PREFIX}/`) ? oldPath.slice(SEED_STORAGE_PREFIX.length + 1) : null;
  const ownFile = !!oldName && SEED_FILE_RE.test(oldName) && oldName.startsWith(`tr_${seedNumber(entry.seed_id)}`);
  // Düzenleme, DB'deki mevcut görselin (bu profilin kendi seed dosyası) üzerine yapıldıysa: mevcut dosya referanstır →
  // yerinde kalır, yolu klona girer. Aksi hâlde referans baytları yüklenir.
  const keepOldAsRef = !!photo.meta.edit && photo.meta.edit.reference_replicate_id === currentId && ownFile;
  if (photo.meta.edit && !keepOldAsRef && !photo.reference) {
    return { status: "error", email, step: "photo", message: "düzenlenmiş görselin referansı yok (zincir korunamaz)" };
  }
  let referencePath: string | null = null;
  if (photo.meta.edit) {
    if (keepOldAsRef) {
      referencePath = oldPath;
    } else {
      const ref = await uploadReference(bucket, entry, photo);
      if (ref.error) return { status: "error", email, step: "upload", message: ref.error };
      referencePath = ref.path;
    }
  }

  const path = storagePath(entry.seed_id, photoTag(photo.meta.replicate_id));
  const { error: uploadError } = await bucket.upload(path, photo.bytes, { contentType: photo.contentType, upsert: true });
  if (uploadError) return { status: "error", email, step: "upload", message: uploadError.message };
  const photoUrl: string = bucket.getPublicUrl(path).data.publicUrl;

  const { data: updated, error: updateError } = await client
    .from("users")
    .update({ photos: [photoUrl], photo_prompt: buildPhotoPrompt(entry, photo.meta, referencePath) })
    .eq("id", user.id).eq("is_seed_profile", true)
    .select("id");
  // Hata: yeni dosya yetim kalabilir (yol deterministik, tekrar koşu aynı yere yazar); canlı fotoğrafı kırmamak için silinmez.
  if (updateError || !updated?.length) return { status: "error", email, step: "update", message: updateError?.message ?? "güncellenen satır yok" };

  // Eski dosya: yalnız bu profilin seed dosyası, yeni görsel ya da referans değilse silinir. Gerçek kullanıcı dosyası
  // (`<uuid>/<ts>.jpg`) ve başka seed profilinin dosyası asla hedeflenmez. Silme hatası kayıt sonucunu bozmaz → orphans.
  const orphans: string[] = [];
  if (oldPath && ownFile && oldPath !== path && oldPath !== referencePath) {
    const { error: rmError } = await bucket.remove([oldPath]);
    if (rmError) orphans.push(`${oldPath}: ${rmError.message}`);
  }
  return { status: "replaced", email, id: user.id, photoUrl, warnings: [], orphans };
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
export async function verifySeedProfile(
  client: SeedClient,
  entry: SelectionEntry,
  head: HeadFn,
  expected?: { replicate_id?: string | null },
): Promise<VerifyReport> {
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
  if (expected?.replicate_id) { // manifestteki (QA'dan geçmiş) görsel DB'deki görsel mi?
    const cloneId = (user.photo_prompt as { replicate_id?: string | null } | null)?.replicate_id ?? null;
    add("foto_kimligi", cloneId === expected.replicate_id, `db=${cloneId ?? "(yok)"} beklenen=${expected.replicate_id}`);
  }
  add("dil_tr", Array.isArray(user.preferred_languages) && user.preferred_languages.includes(LOCALE));

  const { data: qs, error: qErr } = await client.from("questions").select("id").eq("user_id", user.id);
  add("soru_3", !qErr && (qs?.length ?? 0) === QUESTIONS_PER_PROFILE, qErr ? qErr.message : `${qs?.length ?? 0} soru`);

  const { data: details, error: dErr } = await client.from("user_details").select("job").eq("user_id", user.id).maybeSingle();
  add("detay_meslek", !dErr && details?.job === entry.job, dErr ? dErr.message : `job=${details?.job ?? "(yok)"}`);

  return { ok: checks.every((c) => c.ok), id: user.id, checks };
}

// --- akış: yetim dosya temizliği -----------------------------------------------------------

export interface OrphanReport { dryRun: boolean; files: number; referenced: number; orphans: string[]; removed: number; warnings: string[] }

/**
 * `photos/seed/` altında hiçbir seed profilinin fotoğrafı ya da düzenleme referansı (`photo_prompt.edit.reference_path`)
 * olmayan tr_NNNN* dosyalarını bulur; `confirm` ile siler. Fotoğraf değişimleri (yerinde değiştirme) sonrası kalan eski
 * görseller için. Yalnız seed deseni (`SEED_FILE_RE`) listelenir — gerçek kullanıcı dosyası kapsam dışı.
 */
export async function cleanupSeedOrphans(client: SeedClient, opts: { confirm: boolean }): Promise<OrphanReport> {
  const { data: users, error } = await client
    .from("users").select("photos, photo_prompt").eq("is_seed_profile", true).like("email", `%${SEED_EMAIL_DOMAIN}`);
  if (error) throw new Error(`users select: ${error.message}`);
  const referenced = new Set<string>();
  for (const u of users ?? []) {
    for (const url of (u.photos as string[] | null) ?? []) {
      const path = storagePathFromUrl(url);
      if (path) referenced.add(path);
    }
    const ref = (u.photo_prompt as { edit?: { reference_path?: string | null } | null } | null)?.edit?.reference_path;
    if (ref) referenced.add(ref);
  }
  const files = await listSeedFiles(client);
  const orphans = files.filter((f) => !referenced.has(f));
  const report: OrphanReport = { dryRun: !opts.confirm, files: files.length, referenced: referenced.size, orphans, removed: 0, warnings: [] };
  if (!opts.confirm || !orphans.length) return report;
  for (let i = 0; i < orphans.length; i += STORAGE_PAGE) {
    const chunk = orphans.slice(i, i + STORAGE_PAGE);
    const { error: rmError } = await client.storage.from(PHOTO_BUCKET).remove(chunk);
    if (rmError) report.warnings.push(`storage remove (${chunk[0]}…): ${rmError.message}`);
    else report.removed += chunk.length;
  }
  return report;
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
export async function deleteSeedProfiles(client: SeedClient, opts: { confirm: boolean; only?: string[] }): Promise<DeleteReport> {
  // `only`: yalnız verilen seed_id'ler (görsel QA reddi → sil + yeniden bas); yoksa tümü.
  const onlyEmails = opts.only?.map(seedEmail);
  // etiketli adlar da (tr_0015.jpg, tr_0015_<tag>.jpg) → numaraya göre eşle; map(storagePath) index'i etiket sanıyordu
  const onlyNums = opts.only ? new Set(opts.only.map(seedNumber)) : null;
  const seedNumOf = (f: string) => /^seed\/tr_(\d{4})(?:_[a-z0-9]+)?\.jpg$/.exec(f)?.[1];
  const selectQ = client.from("users").select("id").eq("is_seed_profile", true);
  const { data: users, error } = await (onlyEmails ? selectQ.in("email", onlyEmails) : selectQ.like("email", `%${SEED_EMAIL_DOMAIN}`));
  if (error) throw new Error(`users select: ${error.message}`);
  const files = (await listSeedFiles(client)).filter((f) => !onlyNums || onlyNums.has(seedNumOf(f) ?? ""));
  const report: DeleteReport = { dryRun: !opts.confirm, users: users?.length ?? 0, files: files.length, deletedUsers: 0, removedFiles: 0, warnings: [] };
  if (!opts.confirm) return report;

  const deleteQ = client.from("users").delete({ count: "exact" }).eq("is_seed_profile", true);
  const { count, error: delError } = await (onlyEmails ? deleteQ.in("email", onlyEmails) : deleteQ.like("email", `%${SEED_EMAIL_DOMAIN}`));
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
