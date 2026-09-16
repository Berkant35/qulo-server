import { presenceCron } from "./presence.cron.js";
import { analyticsAggregateCron, analyticsCleanupCron } from "./analytics.cron.js";
import { notificationEngineCron } from "./notification-engine.cron.js";
import { campaignDispatchCron } from "./campaign-dispatch.cron.js";
import { webQuizPurgeCron } from "./web-quiz.cron.js";
import { seedReplyCron } from "./seed-reply.cron.js";

export interface CronJob {
  name: string;
  description: string;
  schedule: string;
  running: boolean;
  start(): void;
  stop(): void;
}

const jobs: CronJob[] = [presenceCron, analyticsAggregateCron, analyticsCleanupCron, campaignDispatchCron, notificationEngineCron, webQuizPurgeCron, seedReplyCron];

export function initCrons() {
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
