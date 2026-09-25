import cron from "node-cron";
import { env } from "../config/env.js";
import { moderatePendingPhotos, moderationEnabled } from "../services/photo-moderation.service.js";

let task: cron.ScheduledTask | null = null;
let inFlight = false;
let anahtarUyarisiVerildi = false;

/** Tik basina fotograf: 25 x (1-30 sn) saatlik pencereye rahat sigar; noOverlap yedek fren. */
export const TIK_BUTCESI = 25;

/**
 * Emniyet supurgesi: asil tarama yukleme aninda (`user.service.uploadPhoto` -> `moderateUploadedPhoto`).
 * Bu cron yalniz kacanlari (sunucu yeniden basladi, NIM gecici hata, eski fotograflar) saatte bir isler.
 * Kalici anahtar app_config.photo_moderation_enabled; NVIDIA_API_KEY yoksa no-op.
 */
export async function photoModerationTick(): Promise<void> {
  if (inFlight) {
    console.warn("[PhotoModerationCron] previous run still in progress, tick skipped");
    return;
  }
  inFlight = true;
  try {
    if (!env.NVIDIA_API_KEY) {
      if (!anahtarUyarisiVerildi) {
        console.warn("[PhotoModerationCron] NVIDIA_API_KEY yok, moderasyon calismiyor");
        anahtarUyarisiVerildi = true;
      }
      return;
    }
    if (!(await moderationEnabled())) return;

    const ozet = await moderatePendingPhotos(TIK_BUTCESI);
    if (ozet.checked > 0) {
      console.log(`[PhotoModeration] checked=${ozet.checked} banned=${ozet.banned} review=${ozet.review} errors=${ozet.errors}`);
    }
  } catch (err) {
    console.error("[PhotoModerationCron] error:", err instanceof Error ? err.message : err);
  } finally {
    inFlight = false;
  }
}

export const photoModerationCron = {
  name: "photo-moderation",
  description: "Profil fotografi taramasi emniyet supurgesi — asil tarama yukleme aninda (saatlik)",
  schedule: "17 * * * *",
  running: false,

  start() {
    if (task) return;
    task = cron.schedule(this.schedule, photoModerationTick, { noOverlap: true });
    this.running = true;
    console.log(`[Cron] ${this.name} started (${this.schedule})`);
  },

  stop() {
    if (task) { task.stop(); task = null; }
    this.running = false;
    console.log(`[Cron] ${this.name} stopped`);
  },
};
