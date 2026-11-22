import cron from "node-cron";
import { env } from "../config/env.js";
import { moderatePendingPhotos, moderationEnabled } from "../services/photo-moderation.service.js";
import { moderatePendingQuestionImages } from "../services/question-image-moderation.service.js";

let task: cron.ScheduledTask | null = null;
let acilisTiki: NodeJS.Timeout | null = null;
let inFlight = false;

/**
 * Deploy sonrasi acilis supurgesi: Railway rolling deploy koşan tiki ortasinda kesiyor (ilk canli tik
 * 8/25'te kesildi); kalanlar bir sonraki saat basini beklemesin. 2 dk: DB/NIM baglantilari otursun.
 */
export const ACILIS_GECIKMESI_MS = 2 * 60 * 1000;
let anahtarUyarisiVerildi = false;

/**
 * Tik basina fotograf (profil ve soru gorseli icin ayri ayri): 2 x 25 x (1-30 sn) saatlik pencereye
 * sigar; noOverlap yedek fren.
 */
export const TIK_BUTCESI = 25;

/** Profil fotografi supurgesi: NVIDIA_API_KEY yoksa no-op (tek seferlik uyari). */
async function profilSupur(): Promise<void> {
  if (!env.NVIDIA_API_KEY) {
    if (!anahtarUyarisiVerildi) {
      console.warn("[PhotoModerationCron] NVIDIA_API_KEY yok, profil moderasyonu calismiyor");
      anahtarUyarisiVerildi = true;
    }
    return;
  }
  if (!(await moderationEnabled())) return;
  const ozet = await moderatePendingPhotos(TIK_BUTCESI);
  if (ozet.checked > 0) {
    console.log(`[PhotoModeration] checked=${ozet.checked} banned=${ozet.banned} review=${ozet.review} errors=${ozet.errors}`);
  }
}

/**
 * Soru gorseli supurgesi: hakem Gemini. Kapi (anahtar + kill-switch) servisin icinde; kapaliysa
 * sorgu/model yok, gorseller pending (gizli) kalir.
 */
async function soruSupur(): Promise<void> {
  const islenen = await moderatePendingQuestionImages(TIK_BUTCESI);
  if (islenen > 0) console.log(`[QuestionImageModeration] checked=${islenen}`);
}

/**
 * Emniyet supurgesi: asil tarama yukleme aninda (profil: `user.service.uploadPhoto` ->
 * `moderateUploadedPhoto`; soru gorseli: `questionMediaService.uploadImage` -> senkron `moderateQuestionImage`).
 * Bu cron yalniz kacanlari (sunucu yeniden basladi, model gecici hata/zaman asimi) saatte bir isler.
 * Kalici anahtar app_config.photo_moderation_enabled (ikisi ortak). Bir supurgenin hatasi digerini durdurmaz.
 */
export async function photoModerationTick(): Promise<void> {
  if (inFlight) {
    console.warn("[PhotoModerationCron] previous run still in progress, tick skipped");
    return;
  }
  inFlight = true;
  try {
    for (const [ad, supur] of [["profile", profilSupur], ["question", soruSupur]] as const) {
      try {
        await supur();
      } catch (err) {
        console.error(`[PhotoModerationCron] ${ad} error:`, err instanceof Error ? err.message : err);
      }
    }
  } finally {
    inFlight = false;
  }
}

export const photoModerationCron = {
  name: "photo-moderation",
  description: "Profil fotografi + soru gorseli taramasi emniyet supurgesi — asil tarama yukleme aninda (saatlik)",
  schedule: "17 * * * *",
  running: false,

  start() {
    if (task) return;
    task = cron.schedule(this.schedule, photoModerationTick, { noOverlap: true });
    acilisTiki = setTimeout(() => { acilisTiki = null; void photoModerationTick(); }, ACILIS_GECIKMESI_MS);
    acilisTiki.unref();
    this.running = true;
    console.log(`[Cron] ${this.name} started (${this.schedule})`);
  },

  stop() {
    if (task) { task.stop(); task = null; }
    if (acilisTiki) { clearTimeout(acilisTiki); acilisTiki = null; }
    this.running = false;
    console.log(`[Cron] ${this.name} stopped`);
  },
};
