import cron from "node-cron";
import { refreshSeedPresence } from "../services/seed-presence.service.js";

let task: cron.ScheduledTask | null = null;
let inFlight = false;

/**
 * Seed profillerin cevrimici/son gorulme ritmi. Bot canli cevap yazarken profilde
 * "5 gun once goruldu" yazmasi tek basina ele veriyordu (kullanici geri bildirimi 2026-09-17).
 * Seed yoksa dogal olarak no-op'tur.
 */
export async function seedPresenceTick(): Promise<void> {
  if (inFlight) {
    console.warn("[SeedPresenceCron] previous run still in progress, tick skipped");
    return;
  }
  inFlight = true;
  try {
    const n = await refreshSeedPresence();
    if (n > 0) console.log(`[SeedPresence] tazelenen=${n}`);
  } catch (err) {
    console.error("[SeedPresenceCron] error:", err instanceof Error ? err.message : err);
  } finally {
    inFlight = false;
  }
}

export const seedPresenceCron = {
  name: "seed-presence",
  description: "Seed profillerin cevrimici/son gorulme ritmi (persona'ya gore, 5 dk)",
  schedule: "*/5 * * * *",
  running: false,

  start() {
    if (task) return;
    task = cron.schedule(this.schedule, seedPresenceTick, { noOverlap: true });
    this.running = true;
    console.log(`[Cron] ${this.name} started (${this.schedule})`);
  },

  stop() {
    if (task) { task.stop(); task = null; }
    this.running = false;
    console.log(`[Cron] ${this.name} stopped`);
  },
};
