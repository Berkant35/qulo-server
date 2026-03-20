/**
 * AI Question Bank seed scripti
 * Kullanım: npx tsx scripts/seed-question-bank.ts
 * Silme:    npx tsx scripts/seed-question-bank.ts --delete
 *
 * src/data/seed/questions_<locale>.json dosyalarını okur ve ai_question_bank tablosuna yazar.
 * UNIQUE(locale, question_text) constraint sayesinde upsert ile çalışır.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const BATCH_SIZE = 200;

interface SeedQuestion {
  locale?: string;
  category: string;
  question_text: string;
  answers: string[];
  hint?: string;
  target_gender?: "male" | "female";
  target_age_min?: number;
  target_age_max?: number;
  tone?: "flirty" | "fun" | "deep";
}

async function seed() {
  const seedDir = join(__dirname, "..", "src", "data", "seed");
  const files = readdirSync(seedDir).filter(
    (f) => f.startsWith("questions_") && f.endsWith(".json")
  );

  if (files.length === 0) {
    console.error("No seed files found in src/data/seed/");
    console.error("Expected files like: questions_tr.json, questions_en.json");
    process.exit(1);
  }

  let totalInserted = 0;

  for (const file of files) {
    const locale = file.replace("questions_", "").replace(".json", "");
    console.log(`\nSeeding ${locale}...`);

    const raw = readFileSync(join(seedDir, file), "utf-8");
    const questions: SeedQuestion[] = JSON.parse(raw);

    console.log(`  Found ${questions.length} questions`);

    for (let i = 0; i < questions.length; i += BATCH_SIZE) {
      const batch = questions.slice(i, i + BATCH_SIZE).map((q) => ({
        locale: q.locale || locale,
        category: q.category,
        question_text: q.question_text,
        answers: q.answers,
        hint: q.hint || null,
        target_gender: q.target_gender || null,
        target_age_min: q.target_age_min || null,
        target_age_max: q.target_age_max || null,
        tone: q.tone || "fun",
      }));

      const { data, error } = await supabase
        .from("ai_question_bank")
        .upsert(batch, {
          onConflict: "locale,question_text",
          ignoreDuplicates: true,
        })
        .select("id");

      if (error) {
        console.error(
          `  Error batch ${i}-${i + BATCH_SIZE}: ${error.message}`
        );
      } else {
        const count = data?.length ?? 0;
        totalInserted += count;
        console.log(`  Batch ${i}-${i + BATCH_SIZE}: ${count} inserted`);
      }
    }
  }

  console.log(`\nDone! Total inserted: ${totalInserted}`);
}

async function deleteAll() {
  console.log("Deleting all question bank entries...");
  const { error } = await supabase
    .from("ai_question_bank")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");

  if (error) {
    console.error("Error:", error.message);
  } else {
    console.log("All entries deleted.");
  }
}

const args = process.argv.slice(2);
if (args.includes("--delete")) {
  deleteAll();
} else {
  seed();
}
