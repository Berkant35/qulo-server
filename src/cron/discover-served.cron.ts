import cron from "node-cron";
import { servedGate } from "../services/served-gate.service.js";

let task: cron.ScheduledTask | null = null;

/** Tek tik: 30 günden eski gösterim kayıtlarını siler (1 istek/gün). Hata tiki düşürmez. */
export async function discoverServedPurgeTick(): Promise<void> {
  try {
    const removed = await servedGate.purgeExpired();
    console.log(`[DiscoverServedCron] Purged ${removed} served row(s)`);
  } catch (err) {
    console.error("[DiscoverServedCron] Error:", err instanceof Error ? err.message : "bilinmeyen");
  }
}

/**
 * Discover gösterim kayıtlarının (LIKE / quiz/start kapısı, migration 077) temizliği.
 * Günde bir, 03:55 — web-quiz-purge (03:40) ve analytics-cleanup (03:15) ile çakışmasın.
 */
export const discoverServedPurgeCron = {
  name: "discover-served-purge",
  description: "Remove discover_served rows older than 30 days (served gate window)",
  schedule: "55 3 * * *",
  running: false,

  start() {
    if (task) return;
    task = cron.schedule(this.schedule, discoverServedPurgeTick);
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
