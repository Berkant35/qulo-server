import { env, type Env } from "../config/env.js";
import { presenceCron } from "./presence.cron.js";
import { analyticsAggregateCron, analyticsCleanupCron } from "./analytics.cron.js";
import { notificationEngineCron } from "./notification-engine.cron.js";
import { campaignDispatchCron } from "./campaign-dispatch.cron.js";
import { webQuizPurgeCron } from "./web-quiz.cron.js";
import { seedReplyCron } from "./seed-reply.cron.js";
import { seedPresenceCron } from "./seed-presence.cron.js";
import { photoModerationCron } from "./photo-moderation.cron.js";
import { discoverServedPurgeCron } from "./discover-served.cron.js";

export interface CronJob {
  name: string;
  description: string;
  schedule: string;
  running: boolean;
  start(): void;
  stop(): void;
}

const jobs: CronJob[] = [presenceCron, analyticsAggregateCron, analyticsCleanupCron, campaignDispatchCron, notificationEngineCron, webQuizPurgeCron, seedReplyCron, seedPresenceCron, photoModerationCron, discoverServedPurgeCron];

/**
 * Cron'lar yalniz uretim sunucusunda kendiliginden baslar. Yerel `npm run dev` ayni prod
 * Supabase'ine baglaniyor (ayri test DB'si yok); kapisiz her gelistirici makinesi ikinci bir
 * cron calistiricisiydi — 2026-09-27'de 24 saatteki 678 bin API isteginin yarisi buradandi.
 * `CRON_ENABLED` acik secimdir: yerelde bir cron'u bilerek denemek (`true`) ya da uretimde
 * cron calistirmamasi gereken ikinci bir servis/replika (`false`).
 */
export function initCrons(cfg: Pick<Env, "NODE_ENV" | "CRON_ENABLED"> = env) {
  const acik = cfg.CRON_ENABLED ? cfg.CRON_ENABLED === "true" : cfg.NODE_ENV === "production";
  if (!acik) {
    console.log(`[Cron] Kapali (NODE_ENV=${cfg.NODE_ENV}); calistirmak icin CRON_ENABLED=true`);
    return;
  }
  // Hepsi baslar; seed-reply'in kalici anahtari app_config.seed_reply_enabled
  // (her tikta okunur), surec ici start/stop degil.
  for (const job of jobs) job.start();
  console.log(`[Cron] Initialized ${jobs.length} cron job(s)`);
}

export function getCronJobs(): Array<{ name: string; description: string; schedule: string; running: boolean }> {
  return jobs.map((j) => ({
    name: j.name,
    description: j.description,
    schedule: j.schedule,
    running: j.running,
  }));
}

export function toggleCronJob(name: string, action: "start" | "stop"): boolean {
  const job = jobs.find((j) => j.name === name);
  if (!job) return false;
  action === "start" ? job.start() : job.stop();
  return true;
}
