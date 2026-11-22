/**
 * Soru gorseli moderasyonu — ELLE canli degerlendirme (vitest DISINDA; CI'da calismaz).
 *
 *   npx tsx scripts/eval-question-image-moderation.ts <klasor>          # yalniz sayar + maliyet tahmini
 *   npx tsx scripts/eval-question-image-moderation.ts <klasor> --yes    # Gemini'ye gercekten sorar (UCRETLI)
 *
 * Klasordeki jpg/png/webp dosyalari uretimdeki yoldan gecer: `normalizeUploadedImage` (JPEG) ->
 * `geminiVisionModerate(QUESTION_IMAGE_PROMPT, 8 sn)` -> `decideQuestionImage`. DB'ye ve depolamaya
 * DOKUNMAZ. Onerilen set (en az 6): 2 cinsel obje, 2 masum benzer nesne (salatada salatalik, meyve
 * tabaginda muz), 1 ic camasiri reklami, 1 normal yemek fotografi. Dosya adina beklenen sonucu yaz
 * (`reject-...` / `approve-...`); tablo beklenenle karsilastirir.
 *
 * Ucret (feedback_paid_api_disclose_first): gorsel basina ~300 giris + ~40 cikis token, Gemini
 * Flash-Lite ile ~$0.0001; `--yes` olmadan model cagrilmaz.
 */
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { normalizeUploadedImage } from "../src/utils/image-normalize.js";
import { QUESTION_IMAGE_PROMPT } from "../src/services/nim.service.js";
import { GEMINI_VISION_MODEL, geminiVisionModerate } from "../src/services/gemini-vision.service.js";
import { QUESTION_IMAGE_TIMEOUT_MS, decideQuestionImage } from "../src/services/question-image-moderation.service.js";

const UZANTILAR = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const TAHMINI_USD_GORSEL_BASINA = 0.0001;

function beklenen(dosya: string): "reject" | "approve" | "?" {
  if (dosya.startsWith("reject")) return "reject";
  if (dosya.startsWith("approve")) return "approve";
  return "?";
}

async function main(): Promise<void> {
  const [klasor, ...bayraklar] = process.argv.slice(2);
  if (!klasor) {
    console.error("Kullanim: npx tsx scripts/eval-question-image-moderation.ts <klasor> [--yes]");
    process.exit(2);
  }
  const bilinmeyen = bayraklar.filter((b) => b !== "--yes");
  if (bilinmeyen.length > 0) {
    console.error(`Bilinmeyen arguman: ${bilinmeyen.join(" ")}`);
    process.exit(2);
  }

  const dosyalar = (await readdir(klasor)).filter((f) => UZANTILAR.has(extname(f).toLowerCase())).sort();
  console.log(`${dosyalar.length} gorsel, model ${GEMINI_VISION_MODEL}, tahmini maliyet ~$${(dosyalar.length * TAHMINI_USD_GORSEL_BASINA).toFixed(4)}`);
  if (!bayraklar.includes("--yes")) {
    console.log("Model cagrilmadi. Gercek degerlendirme icin --yes ekle (ucretli).");
    return;
  }

  const satirlar: Array<Record<string, string>> = [];
  for (const dosya of dosyalar) {
    const ham = await readFile(join(klasor, dosya));
    try {
      const jpeg = await normalizeUploadedImage(ham, "question-media");
      const sonuc = await geminiVisionModerate(`data:image/jpeg;base64,${jpeg.toString("base64")}`, {
        prompt: QUESTION_IMAGE_PROMPT, timeoutMs: QUESTION_IMAGE_TIMEOUT_MS,
      });
      const karar = decideQuestionImage(sonuc);
      const sonucAdi = karar.outcome;
      const hedef = beklenen(dosya);
      satirlar.push({
        dosya, karar: sonucAdi, beklenen: hedef, dogru: hedef === "?" ? "-" : hedef === sonucAdi ? "EVET" : "HAYIR",
        kategori: karar.category ?? "-", gerekce: karar.reason.slice(0, 80),
      });
    } catch (err) {
      satirlar.push({ dosya, karar: "pending (hata)", beklenen: beklenen(dosya), dogru: "-", kategori: "-", gerekce: String(err instanceof Error ? err.message : err).slice(0, 80) });
    }
  }
  console.table(satirlar);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
