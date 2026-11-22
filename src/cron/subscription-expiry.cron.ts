import cron from "node-cron";
import { subscriptionService } from "../services/subscription.service.js";

let task: cron.ScheduledTask | null = null;

/** Tek tik: suresi dolmus abonelik satirlarini kapatir (1 istek/gun). Hata tiki dusurmez. */
export async function subscriptionExpiryTick(now: Date = new Date()): Promise<void> {
  try {
    const closed = await subscriptionService.expireLapsedRows(now);
    console.log(`[SubscriptionExpiryCron] Expired ${closed} lapsed subscription row(s)`);
  } catch (err) {
    console.error("[SubscriptionExpiryCron] Error:", err instanceof Error ? err.message : "bilinmeyen");
  }
}

/**
 * user_subscriptions sure dolumu taramasi (2026-11-09: webhook'u gelmeyen 8 satir aylarca `active`
 * kaldi). Gunde bir, 04:10 — diger gunluk temizliklerle (03:15, 03:40, 03:55) cakismasin.
 */
export const subscriptionExpiryCron = {
  name: "subscription-expiry",
  description: "Mark user_subscriptions rows expired when expires_at passed (3-day grace)",
  schedule: "10 4 * * *",
  running: false,

  start() {
    if (task) return;
    task = cron.schedule(this.schedule, () => subscriptionExpiryTick());
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
