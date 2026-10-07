import { supabase } from "../config/supabase.js";
import { env } from "../config/env.js";
import { LlmError } from "./llm.common.js";
import { NIM_VISION_CONFIRM_MODEL, NIM_VISION_MODEL, VISION_VERIFY_PROMPT, nimVisionModerate, type VisionModerationResult } from "./nim.service.js";
import { GEMINI_VISION_MODEL, geminiVisionAvailable, geminiVisionModerate } from "./gemini-vision.service.js";
import { banService } from "./ban.service.js";

export type Verdict = "safe" | "explicit" | "review" | "error";

interface CheckRow { user_id: string; photo_url: string; verdict: Verdict; checked_at: string; attempts: number | null }
interface UserPhotosRow { id: string; photos: string[] | null }
/** `attempts`: onceki deneme sayisi (ilk tarama 0). */
export interface PendingPhoto { userId: string; url: string; attempts: number }
export interface ModerationSummary { checked: number; banned: number; review: number; errors: number }

/** `error` satiri bu sureden sonra yeniden denenir (gecici NIM/indirme hatasi). */
export const ERROR_RETRY_MS = 60 * 60 * 1000;
/** Bu kadar denemeden sonra hala hata -> `review` (zombi fotograf butceyi her saat yemesin). */
export const MAX_ATTEMPTS = 3;
/** Tarama penceresi: son aktif kullanicilar once (yukleme = aktiflik; yeni kayit da aktif). */
const USER_SCAN_LIMIT = 1000;
/** `.in()` URL siniri tuzagi (4. kez): id listesi parcalanir. */
const IN_CHUNK = 50;
/** Fotograf indirme: 4 MB'lik gercek dosya 200 OK dondu; 8 MB ustu modele gonderilmez. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
/** 514 baytlik bozuk dosyaya 11B "exposed nipples" dedi (2026-09-25); gercek fotograf bu kadar kucuk olamaz. */
export const MIN_PHOTO_BYTES = 10 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
/** Onay modeli (Gemma 4) ucretsiz kuyrukta 90 sn'yi asabiliyor (canli: tam da explicit fotograflarda); yol asenkron, bekleyebiliriz. */
export const CONFIRM_TIMEOUT_MS = 180_000;
/** Ban gerekcesi (users.ban_reason, admin panelinde gorunur). */
export const BAN_REASON_TEXT = "photo_moderation: sexual content (vision, confirmed)";

/**
 * 11B'nin `explicit=false` deyip gerekcede ciplaklik yazdigi goruldu (2026-09-25 tarama, 3/99).
 * Ban icin iki modelin de "evet" demesi sart oldugundan bu celiskiler banlanamaz; insan gozu icin
 * `review`'a dusurulur (model cagrisi yok). Olumsuzlama ("no nudity") ayiklanir — canli ilk tikte
 * her temiz fotograf bu yuzden onaya gidip Gemma kuyrugunu tikiyordu.
 */
const SUPHELI_KELIME = /\b(exposed|nude|naked|nudity|genital|nipple|topless|sexual act)/i;
const OLUMSUZLAMA = /\b(no|not|non|without|none|isn't|aren't|doesn't|does not)\b/i;

export function supheliGerekce(reason: string): boolean {
  return SUPHELI_KELIME.test(reason) && !OLUMSUZLAMA.test(reason);
}

function hataMetni(err: unknown): string {
  return err instanceof LlmError ? `${err.code}: ${err.message}` : String(err);
}

function parcala<T>(dizi: T[], boyut: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < dizi.length; i += boyut) out.push(dizi.slice(i, i + boyut));
  return out;
}

/** Taranmamis (veya eski `error`) fotograflar; seed/test hesaplari ve banlilar disarida. */
export async function listPendingPhotos(limit: number, now = Date.now()): Promise<PendingPhoto[]> {
  const { data: users, error } = await supabase
    .from("users")
    .select("id, photos")
    .eq("is_deleted", false)
    .eq("is_banned", false)
    .eq("is_test_account", false)
    .not("photos", "is", null)
    .order("last_active_at", { ascending: false, nullsFirst: false })
    .limit(USER_SCAN_LIMIT);
  if (error) throw new Error(`users query failed: ${error.message}`);

  const sahipler = ((users ?? []) as UserPhotosRow[]).filter((u) => (u.photos?.length ?? 0) > 0);
  const kontroller = new Map<string, CheckRow>();
  for (const grup of parcala(sahipler.map((u) => u.id), IN_CHUNK)) {
    const { data, error: kontrolHatasi } = await supabase
      .from("photo_moderation_checks")
      .select("user_id, photo_url, verdict, checked_at, attempts")
      .in("user_id", grup);
    if (kontrolHatasi) throw new Error(`checks query failed: ${kontrolHatasi.message}`);
    for (const row of (data ?? []) as CheckRow[]) kontroller.set(row.photo_url, row);
  }

  const bekleyen: PendingPhoto[] = [];
  for (const u of sahipler) {
    for (const url of u.photos ?? []) {
      const k = kontroller.get(url);
      const yenidenDene = k?.verdict === "error" && now - new Date(k.checked_at).getTime() >= ERROR_RETRY_MS;
      if (!k || yenidenDene) bekleyen.push({ userId: u.id, url, attempts: k?.attempts ?? 0 });
      if (bekleyen.length >= limit) return bekleyen;
    }
  }
  return bekleyen;
}

async function fotografiIndir(url: string): Promise<{ dataUrl: string } | { hata: string; kalici: boolean }> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    return { hata: `fetch: ${(err as Error)?.message ?? err}`, kalici: false };
  }
  if (!res.ok) return { hata: `fetch HTTP ${res.status}`, kalici: res.status === 404 };
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_PHOTO_BYTES) return { hata: `too_large:${buf.length}`, kalici: true };
  if (buf.length < MIN_PHOTO_BYTES) return { hata: `too_small:${buf.length}`, kalici: true };
  const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  return { dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
}

export interface Classification { verdict: Verdict; reason: string; model: string }

interface OnayAdimi { etiket: string; model: string; cagir: () => Promise<VisionModerationResult> }

/**
 * Onay zinciri (ilk cevap veren karar verir): Gemini Flash-Lite (anahtar varsa) -> Gemma 4 (NIM) ->
 * 11B'nin kendisi farkli istemle. Gemini one alindi: Gemma gercek musteh cen fotografta hic cevap
 * vermiyor, 11B yedek onayi ise gercek cinsel organ fotografina "yok" dedi (2026-10-07, iki haftada
 * 0 ban). Gemini ayni fotograflarda 9/9 dogru, 1-10 sn (gemini-vision.service).
 */
function onayZinciri(dataUrl: string): OnayAdimi[] {
  const gemini: OnayAdimi[] = geminiVisionAvailable()
    ? [{ etiket: "onay", model: GEMINI_VISION_MODEL, cagir: () => geminiVisionModerate(dataUrl) }]
    : [];
  return [
    ...gemini,
    { etiket: "onay-nim", model: NIM_VISION_CONFIRM_MODEL, cagir: () => nimVisionModerate(dataUrl, { model: NIM_VISION_CONFIRM_MODEL, timeoutMs: CONFIRM_TIMEOUT_MS }) },
    { etiket: "yedek-onay", model: `${NIM_VISION_MODEL}#verify`, cagir: () => nimVisionModerate(dataUrl, { model: NIM_VISION_MODEL, prompt: VISION_VERIFY_PROMPT }) },
  ];
}

/**
 * Iki asama: 11B tarar. "Evet" derse onay zinciri sorulur: evet -> explicit (ban), hayir -> review,
 * hepsi hata/timeout -> error (cron 1 saat sonra yeniden dener, 3 denemede review).
 * 11B "hayir" derse onay cagrilmaz (ban zaten imkansiz): gerekce supheliyse review, degilse safe.
 * Belirsizlikte ASLA ban yok (fail-open), ama kayit dusulur.
 */
export async function classifyPhoto(url: string): Promise<Classification> {
  const indirme = await fotografiIndir(url);
  if ("hata" in indirme) return { verdict: indirme.kalici ? "review" : "error", reason: indirme.hata, model: "" };

  let birinci;
  try {
    birinci = await nimVisionModerate(indirme.dataUrl);
  } catch (err) {
    return { verdict: "error", reason: hataMetni(err), model: NIM_VISION_MODEL };
  }
  if (!birinci.explicit) {
    return { verdict: supheliGerekce(birinci.reason) ? "review" : "safe", reason: birinci.reason, model: NIM_VISION_MODEL };
  }

  const onaylar = onayZinciri(indirme.dataUrl);
  const hatalar: string[] = [];
  for (const onay of onaylar) {
    try {
      const ikinci = await onay.cagir();
      return {
        verdict: ikinci.explicit ? "explicit" : "review",
        reason: `tarama(true): ${birinci.reason} | ${onay.etiket}(${ikinci.explicit}): ${ikinci.reason}${hatalar.length ? ` | ${hatalar.join("; ")}` : ""}`,
        model: onay.model,
      };
    } catch (err) {
      hatalar.push(`${onay.etiket} hata: ${hataMetni(err)}`);
    }
  }
  return { verdict: "error", reason: `tarama(true): ${birinci.reason} | ${hatalar.join("; ")}`, model: onaylar[0]!.model };
}

async function kaydet(p: PendingPhoto, c: Classification): Promise<void> {
  const { error } = await supabase
    .from("photo_moderation_checks")
    .upsert(
      {
        user_id: p.userId, photo_url: p.url, verdict: c.verdict, reason: c.reason.slice(0, 500),
        model: c.model, attempts: p.attempts + 1, checked_at: new Date().toISOString(),
      },
      { onConflict: "photo_url" },
    );
  if (error) console.error("[photo-moderation] kayit yazilamadi", { url: p.url, err: error.message });
}

export interface PhotoOutcome { verdict: Verdict; banned: boolean }

/** Tek fotograf: siniflandir, kaydet, explicit ise banla. Yukleme yolu ve cron ayni fonksiyonu kullanir. */
export async function moderatePhoto(p: PendingPhoto): Promise<PhotoOutcome> {
  const sonuc = await classifyPhoto(p.url);
  if (sonuc.verdict === "error" && p.attempts + 1 >= MAX_ATTEMPTS) {
    sonuc.verdict = "review";
    sonuc.reason = `max_attempts: ${sonuc.reason}`;
  }
  await kaydet(p, sonuc);
  if (sonuc.verdict === "review") {
    // Gerekce (beden tarifi) log'a degil DB'ye; admin oradan okur.
    console.warn(`[photo-moderation] REVIEW user=${p.userId} model=${sonuc.model}`);
  }
  let banned = false;
  if (sonuc.verdict === "explicit") {
    banned = await banService.banUser(p.userId, "sexual_content", BAN_REASON_TEXT);
    console.warn(`[photo-moderation] BANNED user=${p.userId} yeni=${banned} model=${sonuc.model}`);
  }
  return { verdict: sonuc.verdict, banned };
}

/** Kill-switch + anahtar: yukleme yolu ve cron ayni kapidan gecer. */
export async function moderationEnabled(): Promise<boolean> {
  if (!env.NVIDIA_API_KEY) return false;
  const { data: cfg } = await supabase.from("app_config").select("photo_moderation_enabled").limit(1).maybeSingle();
  return Boolean(cfg?.photo_moderation_enabled);
}

/**
 * Yukleme aninda tarama: `uploadPhoto` cevabi beklemez (model 1-30 sn), arka planda calisir.
 * Hata yukleme akisina asla sizmaz; kacan fotografi saatlik cron suparur.
 */
export async function moderateUploadedPhoto(userId: string, url: string): Promise<PhotoOutcome | null> {
  try {
    if (!(await moderationEnabled())) return null;
    return await moderatePhoto({ userId, url, attempts: 0 });
  } catch (err) {
    console.error("[photo-moderation] upload-time moderation failed", { userId, err: err instanceof Error ? err.message : err });
    return null;
  }
}

/** Cron tiki (emniyet supurgesi): yukleme anini kaciran fotograflari butce kadar isler. */
export async function moderatePendingPhotos(budget: number): Promise<ModerationSummary> {
  const ozet: ModerationSummary = { checked: 0, banned: 0, review: 0, errors: 0 };
  const banlananlar = new Set<string>();

  for (const p of await listPendingPhotos(budget)) {
    if (banlananlar.has(p.userId)) continue;
    const { verdict, banned } = await moderatePhoto(p);
    ozet.checked++;
    if (verdict === "error") ozet.errors++;
    if (verdict === "review") ozet.review++;
    if (verdict === "explicit") {
      banlananlar.add(p.userId);
      if (banned) ozet.banned++;
    }
  }
  return ozet;
}

// ---- Backoffice: review kuyrugu (insan gozu) ----

export interface AdminCheckRow {
  id: string; user_id: string; photo_url: string; verdict: Verdict; reason: string | null;
  model: string | null; attempts: number; checked_at: string;
  email: string | null; name: string | null; is_banned: boolean; hala_profilde: boolean;
}
interface AdminUserRow { id: string; email: string | null; name: string | null; is_banned: boolean; photos: string[] | null }

/**
 * Admin listesi: verdict'e gore sayfalanmis kayitlar + sahibi. `review` satirlari 2026-09-25'ten
 * 10-07'ye kadar hic goruntulenmedi (sayfa yoktu; 21 satir birikti, biri gercek cinsel icerik).
 */
export async function listChecksForAdmin(verdict: Verdict | "all", page: number, limit: number): Promise<{ rows: AdminCheckRow[]; total: number }> {
  let q = supabase
    .from("photo_moderation_checks")
    .select("id, user_id, photo_url, verdict, reason, model, attempts, checked_at", { count: "exact" })
    .order("checked_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (verdict !== "all") q = q.eq("verdict", verdict);
  const { data, count, error } = await q;
  if (error) throw new Error(`moderation list failed: ${error.message}`);
  const checks = (data ?? []) as Omit<AdminCheckRow, "email" | "name" | "is_banned" | "hala_profilde">[];
  const ids = [...new Set(checks.map((c) => c.user_id))];
  const kullanicilar = new Map<string, AdminUserRow>();
  for (const parca of parcala(ids, IN_CHUNK)) {
    const { data: users, error: uErr } = await supabase.from("users").select("id, email, name, is_banned, photos").in("id", parca);
    if (uErr) throw new Error(`moderation users failed: ${uErr.message}`);
    for (const u of (users ?? []) as AdminUserRow[]) kullanicilar.set(u.id, u);
  }
  const rows = checks.map((c) => {
    const u = kullanicilar.get(c.user_id);
    return {
      ...c, attempts: c.attempts ?? 1, email: u?.email ?? null, name: u?.name ?? null,
      is_banned: u?.is_banned ?? false, hala_profilde: (u?.photos ?? []).includes(c.photo_url),
    };
  });
  return { rows, total: count ?? 0 };
}

export type AdminCheckAction = "ban" | "safe";

/**
 * Insan karari: `ban` -> banService (e-posta + itiraz) ve satir `explicit`; `safe` -> satir `safe`.
 * Satir yoksa false. Ban idempotent (zaten banliysa yalniz satir guncellenir).
 */
export async function resolveCheck(checkId: string, action: AdminCheckAction): Promise<boolean> {
  const { data, error: okumaHatasi } = await supabase.from("photo_moderation_checks").select("id, user_id").eq("id", checkId).maybeSingle();
  if (okumaHatasi) throw new Error(`moderation lookup failed: ${okumaHatasi.message}`);
  const satir = data as { id: string; user_id: string } | null;
  if (!satir) return false;
  if (action === "ban") await banService.banUser(satir.user_id, "sexual_content", `${BAN_REASON_TEXT} (admin review)`);
  const { error } = await supabase
    .from("photo_moderation_checks")
    .update({ verdict: action === "ban" ? "explicit" : "safe", model: "admin", checked_at: new Date().toISOString() })
    .eq("id", checkId);
  if (error) throw new Error(`moderation resolve failed: ${error.message}`);
  return true;
}
