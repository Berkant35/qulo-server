import { env } from '../config/env.js';
import { LlmError, llmPost, type LlmResult, type LlmTurn } from './llm.common.js';
import { NIM_CHAT_MODEL, nimChat } from './nim.service.js';

export type { LlmTurn, LlmResult };
/** Geriye uyumlu ad — cagiranlar `instanceof SeedLlmError` ile ayirt eder. */
export { LlmError as SeedLlmError };

type SeedLlmProvider = typeof env.SEED_LLM_PROVIDER;

/** Model karari 2026-09-16 tarihli kendi Turkce eval setimizle verildi (spec §9). */
const GEMINI_MODEL = 'gemini-3.5-flash-lite';

/**
 * Saglayici secimi tek noktada (spec "Model degisimi"): `SEED_LLM_PROVIDER=nvidia` ile seed
 * cevaplari NVIDIA NIM (Gemma 4) uzerinden uretilir; varsayilan Gemini.
 * `?? 'gemini'` zod default'u yuzunden prod'da olu daldir; testlerin env mock'u alani vermiyor,
 * onun icin duruyor — SILME.
 */
export const SEED_LLM_PROVIDER: SeedLlmProvider = env.SEED_LLM_PROVIDER ?? 'gemini';
export const SEED_LLM_MODEL = SEED_LLM_PROVIDER === 'nvidia' ? NIM_CHAT_MODEL : GEMINI_MODEL;

/** $/1M token — log'daki maliyet tahmini icin. */
const FIYAT = { girisUsd: 0.30, cikisUsd: 2.50 };
const TEMPERATURE = 1.0;
const MAX_OUTPUT_TOKENS = 2000;

const GUVENLIK = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map((category) => ({ category, threshold: 'BLOCK_NONE' }));

interface SeedReplyOpts { system: string; turns: LlmTurn[]; timeoutMs?: number }

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export async function generateSeedReply(opts: SeedReplyOpts): Promise<LlmResult> {
  if (SEED_LLM_PROVIDER === 'nvidia') {
    return nimChat({
      model: NIM_CHAT_MODEL,
      system: opts.system,
      turns: opts.turns,
      temperature: TEMPERATURE,
      maxTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: opts.timeoutMs,
    });
  }
  return geminiGenerate(opts);
}

async function geminiGenerate(opts: SeedReplyOpts): Promise<LlmResult> {
  if (!env.GEMINI_API_KEY) {
    throw new LlmError('no_key', 'GEMINI_API_KEY tanimli degil');
  }

  const json = await llmPost<GeminiResponse>({
    saglayici: 'Gemini',
    url: `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    headers: { 'x-goog-api-key': env.GEMINI_API_KEY },
    body: {
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: opts.turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
      generationConfig: {
        temperature: TEMPERATURE,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingLevel: 'minimal' },
      },
      safetySettings: GUVENLIK,
    },
    timeoutMs: opts.timeoutMs,
  });

  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  const inputTokens = json.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = json.usageMetadata?.candidatesTokenCount ?? 0;

  const usd = (inputTokens * FIYAT.girisUsd + outputTokens * FIYAT.cikisUsd) / 1_000_000;
  console.log(`[Llm] provider=gemini model=${GEMINI_MODEL} in=${inputTokens} out=${outputTokens} usd=${usd.toFixed(6)}`);

  if (!text) throw new LlmError('empty', 'Gemini bos cevap dondu');
  return { text, inputTokens, outputTokens };
}
