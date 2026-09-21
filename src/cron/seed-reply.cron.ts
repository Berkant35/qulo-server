import cron from "node-cron";
import { supabase } from "../config/supabase.js";
import {
  scanAndEnqueue, claimDue, recoverStale,
  processRow, askQuestion, answerQuestionRow, respondMediaRequest,
  type QueueRow, type IslemSonucu,
} from "../services/seed-reply.service.js";

let task: cron.ScheduledTask | null = null;
let inFlight = false;

/** Tik basina ust sinir: chatLimiter servis cagrisinda devrede DEGIL, fren burada. */
const TIK_BUTCESI = 6;

/**
 * Kuyruk turu -> isleyici. `Record` exhaustive: `kind` union'ina yeni bir deger
 * eklendiginde bu tablo doldurulana kadar derleme kirilir. Donus tipi `string`'e
 * genisletilmemeli, yoksa asagidaki `=== "failed"` karsilastirmasi tip denetiminden cikar.
 *
 * `??` fallback'i derleyiciye gore olu ama `claimDue` RPC sonucunu cast ediyor:
 * uretimde union disi bir `kind` (eski satir) gercekten gelebilir.
 */
const ISLEYICILER: Record<QueueRow["kind"], (row: QueueRow) => Promise<IslemSonucu>> = {
  message: processRow,
  question: askQuestion,
  question_answer: answerQuestionRow,
  media_request: respondMediaRequest,
};

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
      const sonuc = await (ISLEYICILER[row.kind] ?? processRow)(row);
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
