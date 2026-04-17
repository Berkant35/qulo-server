import cron from "node-cron";
import { PresenceService } from "../services/presence.service.js";

let task: cron.ScheduledTask | null = null;

export const presenceCron = {
  name: "presence-expiry",
  description: "Mark inactive users as offline (last_seen > 3 min)",
  schedule: "*/3 * * * *", // Every 3 minutes
  running: false,

  start() {
    if (task) return;
    task = cron.schedule(this.schedule, async () => {
      try {
        const count = await PresenceService.expireInactiveUsers(3);
        if (count > 0) {
          console.log(`[PresenceCron] Marked ${count} users offline`);
        }
      } catch (err) {
        console.error("[PresenceCron] Error:", err instanceof Error ? err.message : err);
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
