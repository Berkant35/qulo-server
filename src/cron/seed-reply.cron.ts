import cron from "node-cron";
import { supabase } from "../config/supabase.js";
import { scanAndEnqueue, claimDue, recoverStale, processRow, askQuestion, answerQuestionRow } from "../services/seed-reply.service.js";

let task: cron.ScheduledTask | null = null;
let inFlight = false;

/** Tik basina ust sinir: chatLimiter servis cagrisinda devrede DEGIL, fren burada. */
const TIK_BUTCESI = 6;

export async function seedReplyTick(): Promise<void> {
  if (inFlight) {
    console.warn("[SeedReplyCron] previous run still in progress, tick skipped");
    return;
  }
  inFlight = true;
  try {
    // Kalici kill-switch: her tikta okunur; restart varsayilana dondurmez.
    const { data: cfg } = await supabase.from("app_config").select("seed_reply_enabled").limit(1).maybeSingle();
    if (!cfg?.seed_reply_enabled) return;

    await recoverStale();
    await scanAndEnqueue();

    const satirlar = await claimDue(TIK_BUTCESI);
    for (const row of satirlar) {
      const sonuc = row.kind === "question" ? await askQuestion(row)
        : row.kind === "question_answer" ? await answerQuestionRow(row)
        : await processRow(row);
      if (sonuc === "failed") {
        console.warn(`[SeedReplyCron] satir basarisiz match=${row.match_id} kind=${row.kind}`);
      }
    }
    if (satirlar.length) console.log(`[SeedReply] islenen=${satirlar.length}`);
  } catch (err) {
    console.error("[SeedReplyCron] error:", err instanceof Error ? err.message : err);
  } finally {
    inFlight = false;
  }
}

export const seedReplyCron = {
  name: "seed-reply",
  description: "Seed profillerin AI cevaplari (10 sn; app_config.seed_reply_enabled ile acilir)",
  schedule: "*/10 * * * * *",
  running: false,

  start() {
    if (task) return;
    task = cron.schedule(this.schedule, seedReplyTick, { noOverlap: true });
    this.running = true;
    console.log(`[Cron] ${this.name} started (${this.schedule})`);
  },

  stop() {
    if (task) { task.stop(); task = null; }
    this.running = false;
    console.log(`[Cron] ${this.name} stopped`);
  },
};
