import cron from "node-cron";
import { campaignService } from "../services/campaign.service.js";

let task: cron.ScheduledTask | null = null;

/** Vadesi gelen planli kampanyalar (campaigns.scheduled_at) — onceden hicbir sey islemiyordu. Motor'dan bagimsiz durdurulabilir. */
export async function campaignDispatchTick(): Promise<void> {
  try {
    const due = await campaignService.dispatchDueCampaigns();
    if (due.dispatched.length || due.failed.length) {
      console.log(`[CampaignDispatchCron] dispatched=${due.dispatched.length} failed=${due.failed.length}`);
    }
  } catch (err) {
    console.error("[CampaignDispatchCron] Error:", err instanceof Error ? err.message : err);
  }
}

export const campaignDispatchCron = {
  name: "campaign-dispatch",
  description: "Send scheduled campaigns whose scheduled_at has passed (every 15 min)",
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
