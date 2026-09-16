import { sendMessageSchema } from '../validators/chat.validator.js';

export type GuardReason =
  | 'bos' | 'schema' | 'uzunluk' | 'iletisim' | 'platform' | 'yasak_kelime' | 'liste' | 'ingilizce' | 'sizinti';

export type GuardResult = { ok: true; text: string } | { ok: false; reason: GuardReason };

/** Bir insan mesaji bu uzunlugu asmaz; asan cikti LLM'i ele verir. */
const MAX_KARAKTER = 300;

const TELEFON = /(?<!\d)(?:\+?9?0?[\s-]?)?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)|\b\d{10,}\b/;
const HESAP = /@[A-Za-z0-9._]{3,}|https?:\/\/|www\.|\b[\w.-]+@[\w.-]+\.\w{2,}\b/;
const PLATFORM = /\b(whatsapp|whatsap|wp'?den|instagram|instagramım|telegram|snapchat|messenger|discord)\b/i;
const YASAK = /yapay\s*zek|dil\s*model|\bbir\s+bot\b|chatbot|asistan|talimat|sistem\s*prompt|\bprompt\b|\bGPT\b|Gemini|OpenAI|algoritma|programlan/i;
const LISTE = /(^|\n)\s*(\d+[.)]\s|[-*•]\s)/;
const INGILIZCE = /\b(the|and|you|your|i am|i'm|sorry|cannot|can't|as an|assistant|language|please|here is|of course|i can)\b/i;

/** Sistem promptundan alinan uzun ve ayirt edici parcalar cevapta gorunuyorsa sizintidir. */
function sizintiVar(text: string, systemPrompt: string): boolean {
  const kucuk = text.toLocaleLowerCase('tr');
  const parcalar = systemPrompt
    .toLocaleLowerCase('tr')
    .split(/[\n:.]/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 18);
  return parcalar.some((p) => kucuk.includes(p));
}

export function validateReply(raw: string, systemPrompt: string): GuardResult {
  const text = raw.trim();
  if (!text) return { ok: false, reason: 'bos' };
  if (text.length > MAX_KARAKTER) return { ok: false, reason: 'uzunluk' };
  if (TELEFON.test(text) || HESAP.test(text)) return { ok: false, reason: 'iletisim' };
  if (PLATFORM.test(text)) return { ok: false, reason: 'platform' };
  if (YASAK.test(text)) return { ok: false, reason: 'yasak_kelime' };
  if (LISTE.test(text)) return { ok: false, reason: 'liste' };
  if ((text.match(INGILIZCE) ? text.match(new RegExp(INGILIZCE, 'gi'))!.length : 0) >= 2) {
    return { ok: false, reason: 'ingilizce' };
  }
  if (sizintiVar(text, systemPrompt)) return { ok: false, reason: 'sizinti' };

  // Son kapi: gercek gonderim yolunun kullandigi sema (1-2000 karakter + HTML reddi).
  const parsed = sendMessageSchema.safeParse({ content: text });
  if (!parsed.success) return { ok: false, reason: 'schema' };

  return { ok: true, text };
}
