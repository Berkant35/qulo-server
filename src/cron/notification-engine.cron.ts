import cron from "node-cron";
import { runEngine, summarizeDecisions } from "../services/notification-engine/index.js";

let task: cron.ScheduledTask | null = null;
let inFlight = false;

/**
 * Lifecycle karar motoru tiki — hata yakalar, cron'u asla dusurmez. Planli kampanyalar ayri iste (campaign-dispatch).
 * Overlap korumasi: uzun suren bir tur (cok gonderim) bitmeden sonraki tik baslarsa ayni kullanicilar iki kez
 * degerlendirilirdi; node-cron noOverlap + inFlight bayragi (dogrudan cagrilar icin) bunu keser.
 */
export async function notificationEngineTick(): Promise<void> {
  if (inFlight) {
    console.warn("[NotificationEngineCron] previous run still in progress, tick skipped");
    return;
  }
  inFlight = true;
  try {
    const result = await runEngine("live");
    if (!result.enabled || result.tableMissing) return;
    const counts = summarizeDecisions(result.decisions);
    console.log(
      `[NotificationEngine] run=${result.runId} mode=${result.mode} evaluated=${result.evaluated} ` +
        `outsideWindow=${result.outsideWindow} decidedToday=${result.decidedToday} noRule=${result.noRule} runCapped=${result.runCapped} ` +
        `sent=${counts.sent} dry_run=${counts.dry_run} suppressed=${counts.suppressed} holdout=${counts.holdout} failed=${counts.failed}`,
    );
  } catch (err) {
    console.error("[NotificationEngineCron] engine error:", err instanceof Error ? err.message : err);
  } finally {
    inFlight = false;
  }
}

export const notificationEngineCron = {
  name: "notification-engine",
  description: "Lifecycle push decision engine (every 15 min, config in /admin/notification-engine)",
  schedule: "*/15 * * * *",
  running: false,

  start() {
    if (task) return;
    task = cron.schedule(this.schedule, notificationEngineTick, { noOverlap: true });
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
