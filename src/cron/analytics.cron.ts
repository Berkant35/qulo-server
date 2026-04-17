import cron from "node-cron";
import { supabase } from "../config/supabase.js";

let aggregateTask: cron.ScheduledTask | null = null;
let cleanupTask: cron.ScheduledTask | null = null;

/**
 * Aggregates yesterday's flow_events into flow_daily_stats.
 * Runs once daily at 02:05 AM.
 */
export const analyticsAggregateCron = {
  name: "analytics-aggregate",
  description: "Aggregate daily flow stats from flow_events into flow_daily_stats",
  schedule: "5 2 * * *", // 02:05 daily
  running: false,

  start() {
    if (aggregateTask) return;
    aggregateTask = cron.schedule(this.schedule, async () => {
      try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const dateStr = yesterday.toISOString().split("T")[0];

        console.log(`[AnalyticsCron] Aggregating stats for ${dateStr}...`);

        const { error } = await supabase.rpc("aggregate_daily_flow_stats", { target_date: dateStr });

        if (error) {
          console.error("[AnalyticsCron] Aggregate error:", error.message);
        } else {
          console.log(`[AnalyticsCron] Aggregated stats for ${dateStr}`);
        }
      } catch (err) {
        console.error("[AnalyticsCron] Error:", err instanceof Error ? err.message : err);
      }
    });
    this.running = true;
    console.log(`[Cron] ${this.name} started (${this.schedule})`);
  },

  stop() {
    if (aggregateTask) {
      aggregateTask.stop();
      aggregateTask = null;
    }
    this.running = false;
    console.log(`[Cron] ${this.name} stopped`);
  },
};

/**
 * Cleans up flow_events older than 90 days.
 * Keeps aggregated data in flow_daily_stats.
 * Runs once daily at 03:15 AM.
 */
export const analyticsCleanupCron = {
  name: "analytics-cleanup",
  description: "Remove flow_events older than 90 days (aggregated stats preserved)",
  schedule: "15 3 * * *", // 03:15 daily
  running: false,

  start() {
    if (cleanupTask) return;
    cleanupTask = cron.schedule(this.schedule, async () => {
      try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 90);
        const cutoffStr = cutoff.toISOString();

        const { error } = await supabase
          .from("flow_events")
          .delete()
          .lt("created_at", cutoffStr);

        if (error) {
          console.error("[AnalyticsCleanup] Error:", error.message);
        } else {
          console.log(`[AnalyticsCleanup] Cleaned up events older than 90 days`);
        }
      } catch (err) {
        console.error("[AnalyticsCleanup] Error:", err instanceof Error ? err.message : err);
      }
    });
    this.running = true;
    console.log(`[Cron] ${this.name} started (${this.schedule})`);
  },

  stop() {
    if (cleanupTask) {
      cleanupTask.stop();
      cleanupTask = null;
    }
    this.running = false;
    console.log(`[Cron] ${this.name} stopped`);
  },
};
