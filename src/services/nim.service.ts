import { env } from '../config/env.js';
import { LlmError, llmPost, type LlmResult, type LlmTurn } from './llm.common.js';

/**
 * NVIDIA NIM (build.nvidia.com) — OpenAI uyumlu uc. SDK'siz fetch, seed-llm ile ayni hata kodlari.
 * Ucretsiz kota: paylasimli kuyruk; gecikme modele gore 0,4 sn – 3 dk arasi degisir.
 * Model karari 2026-09-25 canli sondasi (tasks/todo.md "NVIDIA NIM"): reasoning modelleri
 * (Nemotron 3.5 / GLM 5.3 / DeepSeek 4.1) dusunce zincirini dokuyor ve 60-195 sn suruyor;
 * Gemma 4 31B 7-23 sn ve Turkcesi dogal (system rolu NIM tarafinda destekleniyor, sondada kullanildi).
 * Model kimlikleri tek noktada (spec "Model degisimi").
 */
export const NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1';
export const NIM_CHAT_MODEL = 'google/gemma-4-31b-it';
export const NIM_SAFETY_MODEL = 'nvidia/nemotron-3.5-content-safety';
export const NIM_EMBED_MODEL = 'nvidia/nemotron-3-embed-1b';

const NIM_VARSAYILAN_TEMPERATURE = 1.0;
const NIM_VARSAYILAN_MAX_TOKENS = 2000;
/** Siniflandirici tek satir doner; fazlasi gereksiz. */
const SAFETY_MAX_TOKENS = 60;

interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
interface ChatCompletion {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
interface EmbeddingResponse { data?: { index?: number; embedding?: number[] }[] }

function nimPost<T>(path: string, body: unknown, timeoutMs: number | undefined): Promise<T> {
  if (!env.NVIDIA_API_KEY) throw new LlmError('no_key', 'NVIDIA_API_KEY tanimli degil');
  return llmPost<T>({
    saglayici: 'NIM',
    url: `${NIM_BASE_URL}${path}`,
    headers: { Authorization: `Bearer ${env.NVIDIA_API_KEY}` },
    body,
    timeoutMs,
  });
}

/** Gemini'nin `model` rolu OpenAI semasinda `assistant`. */
function mesajlar(system: string | undefined, turns: LlmTurn[]): ChatMessage[] {
  const sistem: ChatMessage[] = system ? [{ role: 'system', content: system }] : [];
  return [
    ...sistem,
    ...turns.map<ChatMessage>((t) => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text })),
  ];
}

export async function nimChat(opts: {
  model?: string;
  system?: string;
  turns: LlmTurn[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<LlmResult> {
  const model = opts.model ?? NIM_CHAT_MODEL;
  const json = await nimPost<ChatCompletion>('/chat/completions', {
    model,
    messages: mesajlar(opts.system, opts.turns),
    temperature: opts.temperature ?? NIM_VARSAYILAN_TEMPERATURE,
    max_tokens: opts.maxTokens ?? NIM_VARSAYILAN_MAX_TOKENS,
  }, opts.timeoutMs);

  const text = (json.choices?.[0]?.message?.content ?? '').trim();
  const inputTokens = json.usage?.prompt_tokens ?? 0;
  const outputTokens = json.usage?.completion_tokens ?? 0;
  console.log(`[Llm] provider=nvidia model=${model} in=${inputTokens} out=${outputTokens}`);

  if (!text) throw new LlmError('empty', 'NIM bos cevap dondu');
  return { text, inputTokens, outputTokens };
}

export interface SafetyResult { safe: boolean; raw: string }

/**
 * Kullanici metnini Nemotron icerik guvenligi siniflandiricisindan gecirir.
 * Model "User Safety: safe|unsafe" (+ "Safety Categories: ...") doner, bazen JSON sarmali.
 * Baska bir sey donerse guvenli kabul ETMEZ — belirsizlik `empty` hatasidir; fail-open/closed karari cagirana ait.
 */
export async function nimContentSafety(text: string, opts: { timeoutMs?: number } = {}): Promise<SafetyResult> {
  const json = await nimPost<ChatCompletion>('/chat/completions', {
    model: NIM_SAFETY_MODEL,
    messages: [{ role: 'user', content: text }],
    max_tokens: SAFETY_MAX_TOKENS,
  }, opts.timeoutMs);
  const raw = (json.choices?.[0]?.message?.content ?? '').trim();
  const eslesme = /user safety"?\s*:\s*"?(safe|unsafe)\b/i.exec(raw);
  if (!eslesme) throw new LlmError('empty', `NIM guvenlik cevabi cozulemedi: ${raw.slice(0, 80)}`);
  return { safe: eslesme[1]!.toLowerCase() === 'safe', raw };
}

/** Vektorler girdi sirasiyla doner; OpenAI semasinda sira `index` ile garanti edilir, dizi sirasiyla degil. */
export async function nimEmbed(
  inputs: string[],
  opts: { inputType?: 'query' | 'passage'; timeoutMs?: number } = {},
): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const json = await nimPost<EmbeddingResponse>('/embeddings', {
    model: NIM_EMBED_MODEL,
    input: inputs,
    input_type: opts.inputType ?? 'passage',
  }, opts.timeoutMs);
  const vektorler = (json.data ?? [])
    .map((d, i) => ({ index: d.index ?? i, embedding: d.embedding ?? [] }))
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
  if (vektorler.length !== inputs.length || vektorler.some((v) => v.length === 0)) {
    throw new LlmError('empty', `NIM embedding sayisi uyusmuyor: ${vektorler.length}/${inputs.length}`);
  }
  return vektorler;
}
