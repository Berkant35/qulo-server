import cron from "node-cron";
import { webQuizService } from "../services/web-quiz.service.js";

let task: cron.ScheduledTask | null = null;

/**
 * Süresi dolan web testlerini siler (attempts cascade ile gider).
 * Günde bir, 03:40 — analytics-cleanup ile çakışmasın.
 */
export const webQuizPurgeCron = {
  name: "web-quiz-purge",
  description: "Remove expired shareable web quizzes (30-day TTL + 1 day grace)",
  schedule: "40 3 * * *",
  running: false,

  start() {
    if (task) return;
    task = cron.schedule(this.schedule, async () => {
      try {
        const removed = await webQuizService.purgeExpired();
        console.log(`[WebQuizCron] Purged ${removed} expired quiz(zes)`);
      } catch (err) {
        console.error("[WebQuizCron] Error:", err instanceof Error ? err.message : err);
      }
    });
    this.running = true;
    console.log(`[Cron] ${this.name} started (${this.schedule})`);
  },

  stop() {
    if (task) {
      task.stop();
      task = null;
    }
    this.running = false;
    console.log(`[Cron] ${this.name} stopped`);
  },
};
