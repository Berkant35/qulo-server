import { supabase } from "../config/supabase.js";
import { LlmError } from "./llm.common.js";
import { NIM_VISION_CONFIRM_MODEL, NIM_VISION_MODEL, nimVisionModerate } from "./nim.service.js";
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
/** Ban gerekcesi (users.ban_reason, admin panelinde gorunur). */
export const BAN_REASON_TEXT = "photo_moderation: sexual content (NIM vision, confirmed)";

/**
 * 11B'nin `explicit=false` deyip gerekcede ciplaklik yazdigi goruldu (2026-09-25 tarama, 3/99).
 * Anahtar kelime gecen her gerekce dogrulama modeline gider; olumsuzlama ayiklamasi YOK —
 * "exposed nipples, not a sexual act" gibi cumleler ayiklamayla safe'e kacardi. Karar onay modelinde.
 */
const SUPHELI_KELIME = /\b(exposed|nude|naked|nudity|genital|nipple|topless|sexual act)/i;

export function supheliGerekce(reason: string): boolean {
  return SUPHELI_KELIME.test(reason);
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

/**
 * Iki asama: 11B tarar; explicit dediyse VEYA gerekcesi supheliyse onay modeli (Gemma 4) dogrular.
 * Ban yalniz IKISI de explicit derse; 11B celiskili (false + supheli gerekce) veya onay katilmaz/hata
 * verirse `review` (admin bakar). Belirsizlikte ASLA ban yok (fail-open), ama kayit dusulur.
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
  if (!birinci.explicit && !supheliGerekce(birinci.reason)) {
    return { verdict: "safe", reason: birinci.reason, model: NIM_VISION_MODEL };
  }

  try {
    const ikinci = await nimVisionModerate(indirme.dataUrl, { model: NIM_VISION_CONFIRM_MODEL });
    return {
      verdict: birinci.explicit && ikinci.explicit ? "explicit" : "review",
      reason: `tarama(${birinci.explicit}): ${birinci.reason} | onay(${ikinci.explicit}): ${ikinci.reason}`,
      model: NIM_VISION_CONFIRM_MODEL,
    };
  } catch (err) {
    return { verdict: "review", reason: `tarama(${birinci.explicit}): ${birinci.reason} | onay hata: ${hataMetni(err)}`, model: NIM_VISION_CONFIRM_MODEL };
  }
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

/** Cron tiki: butce kadar fotograf siniflandirir; explicit -> ban (e-posta + itiraz baglantisi). */
export async function moderatePendingPhotos(budget: number): Promise<ModerationSummary> {
  const ozet: ModerationSummary = { checked: 0, banned: 0, review: 0, errors: 0 };
  const banlananlar = new Set<string>();

  for (const p of await listPendingPhotos(budget)) {
    if (banlananlar.has(p.userId)) continue;
    const sonuc = await classifyPhoto(p.url);
    if (sonuc.verdict === "error" && p.attempts + 1 >= MAX_ATTEMPTS) {
      sonuc.verdict = "review";
      sonuc.reason = `max_attempts: ${sonuc.reason}`;
    }
    await kaydet(p, sonuc);
    ozet.checked++;
    if (sonuc.verdict === "error") ozet.errors++;
    if (sonuc.verdict === "review") {
      ozet.review++;
      // Gerekce (beden tarifi) log'a degil DB'ye; admin oradan okur.
      console.warn(`[photo-moderation] REVIEW user=${p.userId} model=${sonuc.model}`);
    }
    if (sonuc.verdict === "explicit") {
      const banlandi = await banService.banUser(p.userId, "sexual_content", BAN_REASON_TEXT);
      banlananlar.add(p.userId);
      if (banlandi) ozet.banned++;
      console.warn(`[photo-moderation] BANNED user=${p.userId} yeni=${banlandi} model=${sonuc.model}`);
    }
  }
  return ozet;
}
