import { presenceCron } from "./presence.cron.js";

export interface CronJob {
  name: string;
  description: string;
  schedule: string;
  running: boolean;
  start(): void;
  stop(): void;
}

const jobs: CronJob[] = [presenceCron];

export function initCrons() {
  for (const job of jobs) {
    job.start();
  }
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
