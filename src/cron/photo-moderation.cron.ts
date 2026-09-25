import cron from "node-cron";
import { supabase } from "../config/supabase.js";
import { env } from "../config/env.js";
import { moderatePendingPhotos } from "../services/photo-moderation.service.js";

let task: cron.ScheduledTask | null = null;
let inFlight = false;
let anahtarUyarisiVerildi = false;

/** Tik basina fotograf: 25 x (1-20 sn) 5 dk'lik pencereye sigar; noOverlap yedek fren. */
export const TIK_BUTCESI = 25;

/**
 * Profil fotografi moderasyonu: gercek kullanicilarin taranmamis fotograflarini NIM gorsel
 * modelinden gecirir; cinsel icerik kesinlesirse hesabi banlar (ban.service e-posta + itiraz).
 * Kalici anahtar app_config.photo_moderation_enabled (her tikta okunur); NVIDIA_API_KEY yoksa no-op.
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
    const { data: cfg } = await supabase.from("app_config").select("photo_moderation_enabled").limit(1).maybeSingle();
    if (!cfg?.photo_moderation_enabled) return;

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
  description: "Profil fotografi cinsel icerik taramasi (NIM vision) + otomatik ban (5 dk)",
  schedule: "*/5 * * * *",
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
