import { env } from '../config/env.js';
import { LlmError, llmPost } from './llm.common.js';
import { parseVisionVerdict, VISION_VERIFY_PROMPT, type VisionModerationResult } from './nim.service.js';

/**
 * Fotograf moderasyonu ONAY modeli (photo-moderation.service). 11B "explicit" dedikten sonra ikinci,
 * farkli aileden goz: Gemini 3.5 Flash-Lite (seed sohbetiyle ayni anahtar, ayni model).
 * Neden NIM degil: Gemma 4 tam da gercek musteh cen fotograflarda hic cevap vermiyor (2026-09-25 canli
 * 90-180 sn timeout; 2026-10-07 olcum 15 dk+ bekledi), 11B'nin kendi yedek onayi gercek bir cinsel
 * organ fotografina "genital yok" dedi — iki haftada 0 ban dustu. Gemini ayni 7 fotografta
 * (1 gercek musteh cen + 6 yanlis alarm) 1-3 sn'de dogru karar verdi (olcum: tasks/todo.md).
 * Ucret: fotograf basina ~300 giris token (~$0.0001); yalniz 11B "evet" dediginde cagrilir.
 */
export const GEMINI_VISION_MODEL = 'gemini-3.5-flash-lite';
/** Gemini gorsel cevabi 1-3 sn; kuyruk yok. 30 sn bol bol yeter, asenkron yolda kimseyi bekletmez. */
export const GEMINI_VISION_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 80;

/** Moderasyon modelinin kendisi guvenlik filtresine takilmasin: siniflandirmasi istenen sey zaten o. */
const GUVENLIK = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map((category) => ({ category, threshold: 'BLOCK_NONE' }));

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

const DATA_URL_DESENI = /^data:([^;]+);base64,(.+)$/s;

/** `data:<mime>;base64,<veri>` -> Gemini inlineData parcasi. */
export function dataUrlToInlineData(dataUrl: string): { mimeType: string; data: string } {
  const m = DATA_URL_DESENI.exec(dataUrl);
  if (!m) throw new LlmError('empty', 'Gemini gorsel: data URL bicimi gecersiz');
  return { mimeType: m[1]!, data: m[2]! };
}

export function geminiVisionAvailable(): boolean {
  return Boolean(env.GEMINI_API_KEY);
}

/**
 * Bir gorseli (data: URL, base64) ikinci goz olarak siniflandirir; istem NIM yedek onayiyla ayni
 * (yanlis pozitif avi). JSON karari yoksa `empty` — belirsizlik guvenli sayilmaz, karar cagirana ait.
 */
export async function geminiVisionModerate(
  imageDataUrl: string,
  opts: { timeoutMs?: number; prompt?: string } = {},
): Promise<VisionModerationResult> {
  if (!env.GEMINI_API_KEY) throw new LlmError('no_key', 'GEMINI_API_KEY tanimli degil');
  const json = await llmPost<GeminiResponse>({
    saglayici: 'Gemini',
    url: `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent`,
    headers: { 'x-goog-api-key': env.GEMINI_API_KEY },
    body: {
      contents: [{
        role: 'user',
        parts: [
          { text: opts.prompt ?? VISION_VERIFY_PROMPT },
          { inlineData: dataUrlToInlineData(imageDataUrl) },
        ],
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingLevel: 'minimal' },
      },
      safetySettings: GUVENLIK,
    },
    timeoutMs: opts.timeoutMs ?? GEMINI_VISION_TIMEOUT_MS,
  });
  const raw = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  const sonuc = parseVisionVerdict(raw, 'Gemini');
  console.log(`[Llm] provider=gemini model=${GEMINI_VISION_MODEL} vision explicit=${sonuc.explicit}`);
  return sonuc;
}
