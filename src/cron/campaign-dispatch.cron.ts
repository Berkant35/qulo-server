import cron from "node-cron";
import { campaignService } from "../services/campaign.service.js";
import { campaignRecurringService } from "../services/campaign-recurring.service.js";

let task: cron.ScheduledTask | null = null;

/**
 * Iki is, birbirinden bagimsiz: (1) vadesi gelen tek seferlik kampanyalar (scheduled_at),
 * (2) tekrarlayan gunluk kampanyalar (kullanici yerel saatine gore pencere ici rastgele dakika).
 * Biri patlarsa digeri yine kosar. Motor'dan bagimsiz durdurulabilir.
 */
export async function campaignDispatchTick(): Promise<void> {
  try {
    const due = await campaignService.dispatchDueCampaigns();
    if (due.dispatched.length || due.failed.length) {
      console.log(`[CampaignDispatchCron] dispatched=${due.dispatched.length} failed=${due.failed.length}`);
    }
  } catch (err) {
    console.error("[CampaignDispatchCron] Error:", err instanceof Error ? err.message : err);
  }
  try {
    await campaignRecurringService.dispatch();
  } catch (err) {
    console.error("[CampaignDispatchCron] Recurring error:", err instanceof Error ? err.message : err);
  }
}

export const campaignDispatchCron = {
  name: "campaign-dispatch",
  description: "Send due one-off campaigns + recurring daily campaigns (random minute in local window, every 15 min)",
  schedule: "*/15 * * * *",
  running: false,

  start() {
    if (task) return;
    task = cron.schedule(this.schedule, campaignDispatchTick, { noOverlap: true });
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
