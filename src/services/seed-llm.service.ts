import { env } from '../config/env.js';

/** Model karari 2026-09-16 tarihli kendi Turkce eval setimizle verildi (spec §9). */
export const SEED_LLM_MODEL = 'gemini-3.5-flash-lite';

/** $/1M token — log'daki maliyet tahmini icin. */
const FIYAT = { girisUsd: 0.30, cikisUsd: 2.50 };
const VARSAYILAN_TIMEOUT_MS = 12_000;

const GUVENLIK = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map((category) => ({ category, threshold: 'BLOCK_NONE' }));

export interface LlmTurn { role: 'user' | 'model'; text: string }
export interface LlmResult { text: string; inputTokens: number; outputTokens: number }

export class SeedLlmError extends Error {
  constructor(public code: 'no_key' | 'http' | 'timeout' | 'empty', message: string) {
    super(message);
    this.name = 'SeedLlmError';
  }
}

export async function generateSeedReply(opts: {
  system: string;
  turns: LlmTurn[];
  timeoutMs?: number;
}): Promise<LlmResult> {
  if (!env.GEMINI_API_KEY) {
    throw new SeedLlmError('no_key', 'GEMINI_API_KEY tanimli degil');
  }

  const body = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: opts.turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    generationConfig: {
      temperature: 1.0,
      maxOutputTokens: 2000,
      thinkingConfig: { thinkingLevel: 'minimal' },
    },
    safetySettings: GUVENLIK,
  };

  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${SEED_LLM_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? VARSAYILAN_TIMEOUT_MS),
      },
    );
  } catch (err) {
    const ad = (err as Error)?.name;
    if (ad === 'TimeoutError' || ad === 'AbortError') {
      throw new SeedLlmError('timeout', 'Gemini istegi zaman asimina ugradi');
    }
    throw new SeedLlmError('http', `Gemini agi hatasi: ${(err as Error)?.message ?? err}`);
  }

  if (!res.ok) {
    throw new SeedLlmError('http', `Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const json = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  const inputTokens = json.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = json.usageMetadata?.candidatesTokenCount ?? 0;

  const usd = (inputTokens * FIYAT.girisUsd + outputTokens * FIYAT.cikisUsd) / 1_000_000;
  console.log(`[SeedLlm] model=${SEED_LLM_MODEL} in=${inputTokens} out=${outputTokens} usd=${usd.toFixed(6)}`);

  if (!text) throw new SeedLlmError('empty', 'Gemini bos cevap dondu');
  return { text, inputTokens, outputTokens };
}
