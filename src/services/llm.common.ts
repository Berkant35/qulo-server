/** Saglayicidan bagimsiz LLM sozlesmesi — Gemini ve NVIDIA NIM istemcileri ayni sekli doner. */
export interface LlmTurn { role: 'user' | 'model'; text: string }
export interface LlmResult { text: string; inputTokens: number; outputTokens: number }

export type LlmErrorCode = 'no_key' | 'http' | 'timeout' | 'empty';

export class LlmError extends Error {
  constructor(public code: LlmErrorCode, message: string) {
    super(message);
    this.name = 'LlmError';
  }
}

export const LLM_VARSAYILAN_TIMEOUT_MS = 12_000;

/** Upstream hata govdesinden log'a alinan azami uzunluk; `last_error` sutununa da yaziliyor. */
const HATA_GOVDE_KARAKTER = 200;
/** Upstream'in Authorization header'ini geri yansitma ihtimaline karsi anahtar desenleri maskelenir. */
const ANAHTAR_DESENI = /nvapi-[\w-]+|AIza[\w-]+/g;

function hataGovdesi(ham: string): string {
  return ham.replace(ANAHTAR_DESENI, '[redacted]').replace(/\s+/g, ' ').slice(0, HATA_GOVDE_KARAKTER);
}

/**
 * Tek fetch iskeleti: abort/ag hatasi -> timeout|http, 2xx disi -> http, bozuk JSON -> empty.
 * Anahtar kontrolu cagirana aittir (no_key); bu fonksiyon anahtari yalniz header icinde tasir.
 */
export async function llmPost<T>(opts: {
  saglayici: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs?: number;
}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(opts.url, {
      method: 'POST',
      headers: { ...opts.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(opts.body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? LLM_VARSAYILAN_TIMEOUT_MS),
    });
  } catch (err) {
    const ad = (err as Error)?.name;
    if (ad === 'TimeoutError' || ad === 'AbortError') {
      throw new LlmError('timeout', `${opts.saglayici} istegi zaman asimina ugradi`);
    }
    throw new LlmError('http', `${opts.saglayici} agi hatasi: ${(err as Error)?.message ?? err}`);
  }

  if (!res.ok) {
    const govde = await res.text().catch(() => '');
    throw new LlmError('http', `${opts.saglayici} HTTP ${res.status}: ${hataGovdesi(govde)}`);
  }

  try {
    return await res.json() as T;
  } catch {
    throw new LlmError('empty', `${opts.saglayici} cevabi cozulemedi (gecersiz JSON)`);
  }
}
