import { supabase } from "../config/supabase.js";
import { QUESTION_MEDIA_BUCKET } from "../constants/question-media.js";
import { NORMAL_GORSEL_MIME } from "../utils/image-normalize.js";
import { LlmError } from "./llm.common.js";
import { QUESTION_IMAGE_PROMPT, type VisionModerationResult } from "./nim.service.js";
import { GEMINI_VISION_MODEL, GEMINI_VISION_TIMEOUT_MS, geminiVisionAvailable, geminiVisionModerate } from "./gemini-vision.service.js";
import { MAX_ATTEMPTS, moderationSwitchOn, supheliGerekce, type Verdict } from "./photo-moderation.service.js";

/**
 * Soru gorseli moderasyonu (sesli/gorselli soru, 2.0.19).
 *
 * Profil fotografindan uc fark:
 * - Senkron: yukleme yaniti karari bekler (8 sn); zaman asimi/hata → `pending`, saatlik cron yeniden dener.
 * - Istem daha kati (QUESTION_IMAGE_PROMPT): cinsel obje, siddet, resit olmayan, kisisel veri de yasak.
 * - Ret = gorsel kaldirilir (yol null, dosya silinir), soru metinle kalir. BAN YOK: bu modul ban servisini
 *   hic cagirmaz; kotuye kullanim admin'in ayri kullanici akisidir.
 *
 * Fail-closed: `approved` yalniz modelin temiz karari + CAS ile yazilir. Anahtar/kill-switch kapali,
 * model hatasi, cozulemeyen cevap → gorsel `pending` kalir (sahibinden baskasina gosterilmez).
 * Karar YALNIZ moderasyonu yapilan yola uygulanir (`image_path = <yol> AND image_status = 'pending'`):
 * araya giren yeni yukleme onaylanmaz, reddi de onu ezmez.
 */
export type QuestionImageModerationStatus = "approved" | "rejected" | "pending";

/** Yukleme yolundaki model bekleme siniri (Gemini gorsel cevabi 1-10 sn). */
export const QUESTION_IMAGE_TIMEOUT_MS = 8000;
/** Cron tarama penceresi: insan kararini bekleyen (`review`) satirlar da pending'dir, butceyi onlar yemesin. */
const PENDING_SCAN_LIMIT = 200;
/** `.in()` URL siniri: yol ~100 karakter, 50'lik parca ~5 KB. */
const IN_CHUNK = 50;
const REASON_MAX = 500;

/** Modelin `category` alani (normalize) bunlardan biriyse `explicit=false` dese de ret (celiski onaylanmaz). */
const YASAK_KATEGORILER = new Set(["sexual_content", "sexual_object", "violence", "minor", "personal_data"]);
/** Onaya izin veren tek kategori degeri; alan hic yoksa da onay mumkun (salatalik vakasi). */
const TEMIZ_KATEGORI = "none";

interface QuestionImageRow { id: string; user_id: string; image_path: string | null; image_status: QuestionImageModerationStatus | null }
interface CheckRow { photo_url: string; verdict: Verdict; attempts: number | null }

/** `approve` | `reject` | `review` (insan karar verir; gorsel pending/gizli kalir, model yeniden sorulmaz). */
export type QuestionImageOutcome = "approve" | "reject" | "review";
export interface QuestionImageDecision { outcome: QuestionImageOutcome; category: string | null; reason: string }

/** "Sexual-Object" / "sexual object" → "sexual_object": yazim varyanti yasak kategoriyi kacirmasin. */
function kategoriNormalize(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * Model cevabindan karar (eval betigi de bunu kullanir). Fail-closed: onay YALNIZ
 * `explicit=false` + category yok ya da "none" + gerekce ciplaklik anlatmiyor iken.
 * - Ret: `explicit`, yasak kategori (normalize), ya da celiskili gerekce (profil taramasinda 11B'de goruldu).
 * - Bilinmeyen kategori ("weapon", "nudity"...) → `review`: otomatik onay da otomatik ret de yok.
 */
export function decideQuestionImage(result: VisionModerationResult): QuestionImageDecision {
  const ham = /"category"\s*:\s*"([^"]*)"/i.exec(result.raw)?.[1];
  const category = ham === undefined || ham.trim() === "" ? null : kategoriNormalize(ham);
  const yasak = result.explicit || (category !== null && YASAK_KATEGORILER.has(category)) || supheliGerekce(result.reason);
  const outcome: QuestionImageOutcome = yasak ? "reject"
    : category === null || category === TEMIZ_KATEGORI ? "approve"
      : "review";
  return { outcome, category, reason: result.reason };
}

/** Hakem Gemini; kill-switch profil ile ortak. NVIDIA anahtari gerekmez. */
export async function questionImageModerationEnabled(): Promise<boolean> {
  if (!geminiVisionAvailable()) return false;
  return moderationSwitchOn();
}

function hataMetni(err: unknown): string {
  return err instanceof LlmError ? `${err.code}: ${err.message}` : String(err instanceof Error ? err.message : err);
}

function parcala<T>(dizi: T[], boyut: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < dizi.length; i += boyut) out.push(dizi.slice(i, i + boyut));
  return out;
}

async function kaydet(q: QuestionImageRow & { image_path: string }, verdict: Verdict, reason: string, attempts: number): Promise<void> {
  const { error } = await supabase.from("photo_moderation_checks").upsert(
    {
      user_id: q.user_id, photo_url: q.image_path, kind: "question", verdict, reason: reason.slice(0, REASON_MAX),
      model: GEMINI_VISION_MODEL, attempts, checked_at: new Date().toISOString(),
    },
    { onConflict: "photo_url" },
  );
  if (error) console.error("[question-image-moderation] kayit yazilamadi", { path: q.image_path, err: error.message });
}

async function dosyayiSil(path: string): Promise<void> {
  const { error } = await supabase.storage.from(QUESTION_MEDIA_BUCKET).remove([path]);
  if (error) console.warn("[question-image-moderation] dosya silinemedi:", path, error.message);
}

/** Private bucket: service-role indirme (public URL yok). Normalize edilmis dosya her zaman JPEG. */
async function gorseliIndir(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(QUESTION_MEDIA_BUCKET).download(path);
  if (error || !data) throw new Error(`download: ${error?.message ?? "bos"}`);
  const buf = Buffer.from(await data.arrayBuffer());
  return `data:${NORMAL_GORSEL_MIME};base64,${buf.toString("base64")}`;
}

/** Hata dali: deneme sayilir; MAX_ATTEMPTS'ta `review` (gorsel gizli kalir, insan karar verir). */
async function hataKaydet(q: QuestionImageRow & { image_path: string }, attempts: number, reason: string): Promise<"pending"> {
  const sonDeneme = attempts >= MAX_ATTEMPTS;
  await kaydet(q, sonDeneme ? "review" : "error", sonDeneme ? `max_attempts: ${reason}` : reason, attempts);
  if (sonDeneme) console.warn(`[question-image-moderation] REVIEW question=${q.id} (max attempts)`);
  return "pending";
}

async function moderateRow(
  q: QuestionImageRow & { image_path: string },
  previousAttempts: number,
  timeoutMs: number,
  bytes?: Buffer,
): Promise<QuestionImageModerationStatus> {
  const attempts = previousAttempts + 1;
  let karar: QuestionImageDecision;
  try {
    const dataUrl = bytes ? `data:${NORMAL_GORSEL_MIME};base64,${bytes.toString("base64")}` : await gorseliIndir(q.image_path);
    karar = decideQuestionImage(await geminiVisionModerate(dataUrl, { prompt: QUESTION_IMAGE_PROMPT, timeoutMs }));
  } catch (err) {
    return hataKaydet(q, attempts, hataMetni(err));
  }

  const gerekce = karar.category ? `${karar.category}: ${karar.reason}` : karar.reason;
  if (karar.outcome === "review") {
    // Belirsiz kategori: soru satirina dokunulmaz (pending = gizli); insan kuyruguna duser.
    await kaydet(q, "review", `unknown_category: ${gerekce}`, attempts);
    console.warn(`[question-image-moderation] REVIEW question=${q.id} category=${karar.category ?? "-"}`);
    return "pending";
  }
  const rejected = karar.outcome === "reject";
  const yeni = rejected
    ? { image_path: null, image_status: "rejected" as const }
    : { image_status: "approved" as const };
  const { data, error } = await supabase
    .from("questions")
    .update(yeni)
    .eq("id", q.id)
    .eq("image_path", q.image_path)
    .eq("image_status", "pending")
    .select("id");
  if (error) return hataKaydet(q, attempts, `questions update: ${error.message}`);

  // CAS kaybi: bu arada yol degisti (eski dosyayi writeSlot/removeMedia zaten sildi) ya da durum degisti
  // (admin karari, es zamanli tarama). Dosyaya ve kayda DOKUNULMAZ: onayli satir silinmis dosyayi
  // gostermesin, admin'in denetim kaydi ezilmesin.
  if (!data || data.length === 0) return "pending";

  if (rejected) await dosyayiSil(q.image_path);
  await kaydet(q, rejected ? "review" : "safe", gerekce, attempts);
  if (rejected) console.warn(`[question-image-moderation] REJECTED question=${q.id} category=${karar.category ?? "-"}`);
  return rejected ? "rejected" : "approved";
}

/**
 * Tek soru gorseli: yukleme yolu (senkron, 8 sn) ve cron ayni fonksiyondan gecer. Asla firlatmaz.
 * Gorsel zaten karara bagliysa model cagrilmaz, mevcut durum doner.
 * `opts.image`: yukleme yolu az once yazdigi baytlari verir (depolamadan geri indirme = egress yok).
 * Baytlar YALNIZ satir hala o yolu gosteriyorsa kullanilir; araya yeni yukleme girdiyse yol indirilir —
 * eski baytlarla yeni gorsel onaylanmaz.
 */
export async function moderateQuestionImage(
  questionId: string,
  opts: { timeoutMs?: number; image?: { path: string; bytes: Buffer } } = {},
): Promise<QuestionImageModerationStatus> {
  try {
    if (!(await questionImageModerationEnabled())) return "pending";
    const { data, error } = await supabase
      .from("questions")
      .select("id, user_id, image_path, image_status")
      .eq("id", questionId)
      .maybeSingle();
    if (error) throw new Error(`questions read: ${error.message}`);
    const q = data as QuestionImageRow | null;
    if (!q?.image_path) return q?.image_status === "rejected" ? "rejected" : "pending";
    if (q.image_status !== "pending") return q.image_status ?? "pending";

    const { data: onceki, error: kontrolHatasi } = await supabase
      .from("photo_moderation_checks")
      .select("photo_url, verdict, attempts")
      .eq("photo_url", q.image_path)
      .maybeSingle();
    if (kontrolHatasi) throw new Error(`checks read: ${kontrolHatasi.message}`);
    const kontrol = onceki as CheckRow | null;
    // Insan kuyrugundaki gorsel modele yeniden sorulmaz.
    if (kontrol && kontrol.verdict !== "error") return "pending";

    const bytes = opts.image?.path === q.image_path ? opts.image.bytes : undefined;
    return await moderateRow({ ...q, image_path: q.image_path }, kontrol?.attempts ?? 0, opts.timeoutMs ?? QUESTION_IMAGE_TIMEOUT_MS, bytes);
  } catch (err) {
    console.error("[question-image-moderation] moderation failed", { questionId, err: hataMetni(err) });
    return "pending";
  }
}

/**
 * Cron tiki (emniyet supurgesi): yukleme anini kaciran (zaman asimi, deploy) pending gorselleri
 * butce kadar isler. Kayitsiz ya da `error` satirli yollar; `review` (insan bekliyor) atlanir.
 * Doner: islenen gorsel sayisi.
 */
export async function moderatePendingQuestionImages(budget: number): Promise<number> {
  if (!(await questionImageModerationEnabled())) return 0;
  const { data, error } = await supabase
    .from("questions")
    .select("id, user_id, image_path, image_status")
    .eq("image_status", "pending")
    .not("image_path", "is", null)
    .order("id", { ascending: true })
    .limit(PENDING_SCAN_LIMIT);
  if (error) throw new Error(`pending question images query failed: ${error.message}`);
  const bekleyen = ((data ?? []) as QuestionImageRow[]).filter((q): q is QuestionImageRow & { image_path: string } => !!q.image_path);
  if (bekleyen.length === 0) return 0;

  const kontroller = new Map<string, CheckRow>();
  for (const grup of parcala(bekleyen.map((q) => q.image_path), IN_CHUNK)) {
    const { data: rows, error: kontrolHatasi } = await supabase
      .from("photo_moderation_checks")
      .select("photo_url, verdict, attempts")
      .in("photo_url", grup);
    if (kontrolHatasi) throw new Error(`question checks query failed: ${kontrolHatasi.message}`);
    for (const row of (rows ?? []) as CheckRow[]) kontroller.set(row.photo_url, row);
  }

  let islenen = 0;
  for (const q of bekleyen) {
    if (islenen >= budget) break;
    const kontrol = kontroller.get(q.image_path);
    if (kontrol && kontrol.verdict !== "error") continue;
    await moderateRow(q, kontrol?.attempts ?? 0, GEMINI_VISION_TIMEOUT_MS);
    islenen++;
  }
  return islenen;
}

export type QuestionImageAdminAction = "safe" | "remove_image";

/**
 * Backoffice karari (YALNIZ soru gorseli satiri; profil satiri → false). Ban YOK.
 * - `safe`: gorsel hala bu yolla soruda ve pending ise `approved`; degilse (degistirildi/silindi) soru
 *   degismez, yalniz insan karari kaydedilir.
 * - `remove_image`: yol null + `rejected`, dosya silinir (dosya zaten gittiyse kaydi kesinlestirir).
 */
export async function resolveQuestionImageCheck(checkId: string, action: QuestionImageAdminAction): Promise<boolean> {
  const { data, error } = await supabase
    .from("photo_moderation_checks")
    .select("id, photo_url, kind")
    .eq("id", checkId)
    .maybeSingle();
  if (error) throw new Error(`moderation lookup failed: ${error.message}`);
  const satir = data as { id: string; photo_url: string; kind?: string } | null;
  if (!satir || satir.kind !== "question") return false;

  const guncelleme = action === "safe"
    ? supabase.from("questions").update({ image_status: "approved" }).eq("image_path", satir.photo_url).eq("image_status", "pending")
    : supabase.from("questions").update({ image_path: null, image_status: "rejected" }).eq("image_path", satir.photo_url);
  const { error: soruHatasi } = await guncelleme;
  if (soruHatasi) throw new Error(`question image resolve failed: ${soruHatasi.message}`);
  if (action === "remove_image") await dosyayiSil(satir.photo_url);

  const { error: kayitHatasi } = await supabase
    .from("photo_moderation_checks")
    .update({ verdict: action === "safe" ? "safe" : "explicit", model: "admin", checked_at: new Date().toISOString() })
    .eq("id", checkId);
  if (kayitHatasi) throw new Error(`moderation resolve failed: ${kayitHatasi.message}`);
  return true;
}
