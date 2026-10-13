import { sendMessageSchema } from '../validators/chat.validator.js';
import { TR_PAKETI, type SeedLocalePack } from './seed-locale/index.js';

export type GuardReason =
  | 'bos' | 'schema' | 'uzunluk' | 'iletisim' | 'platform' | 'yasak_kelime' | 'liste' | 'ingilizce' | 'sizinti';

export type GuardResult = { ok: true; text: string } | { ok: false; reason: GuardReason };

/** Bir insan mesaji bu uzunlugu asmaz; asan cikti LLM'i ele verir. */
const MAX_KARAKTER = 300;

// Dilden bagimsiz desenler. Telefon bicimi, ele veren kelimeler ve yabanci dil isareti dil
// paketinde (seed-locale): TR'de 5xx mobil, Italyada 3xx mobil / 0x sabit.
const HESAP = /@[A-Za-z0-9._]{3,}|https?:\/\/|www\.|\b[\w.-]+@[\w.-]+\.\w{2,}\b/;
// Turkce eklemeli bir dil: "telegramdan", "whatsapptan" gibi ekli hallerde kapanis \b
// siniri eslesmiyor ve filtre bos geciriyordu. Uzun govdeler serbest ek alir; `wp` ve
// `insta` kisa/belirsiz oldugu icin tam kelime sarti var ("instalasyon" yanlis pozitifti).
// `whatsap` tek p'li yaygin yazim — eski desende vardi, korunuyor.
const PLATFORM = /\b(whats\s*app|whatsap|instagram|telegram|snapchat|messenger|discord)\w*|\b(wp|insta)\b/i;
const LISTE = /(^|\n)\s*(\d+[.)]\s|[-*•]\s)/;

/** Sistem promptundan alinan uzun ve ayirt edici parcalar cevapta gorunuyorsa sizintidir. */
function sizintiVar(text: string, systemPrompt: string, dil: string): boolean {
  const kucuk = text.toLocaleLowerCase(dil);
  const parcalar = systemPrompt
    .toLocaleLowerCase(dil)
    .split(/[\n:.]/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 18);
  return parcalar.some((p) => kucuk.includes(p));
}

/** Desenin metindeki eslesme sayisi (global kopya ile; kaynak desen durum tutmaz). */
function eslesmeSayisi(text: string, desen: RegExp): number {
  return text.match(new RegExp(desen.source, desen.flags.includes('g') ? desen.flags : `${desen.flags}g`))?.length ?? 0;
}

/**
 * Bot ciktisinin son denetimi. `paket` seed'in dil paketi (varsayilan TR — mevcut cagiranlar
 * ve testler); `ingilizce` sebebi "paketin yabanci dil isareti" anlamindadir (log uyumu).
 */
export function validateReply(raw: string, systemPrompt: string, paket: SeedLocalePack = TR_PAKETI): GuardResult {
  const text = raw.trim();
  const g = paket.guard;
  if (!text) return { ok: false, reason: 'bos' };
  if (text.length > MAX_KARAKTER) return { ok: false, reason: 'uzunluk' };
  if (g.telefon.test(text) || HESAP.test(text)) return { ok: false, reason: 'iletisim' };
  if (PLATFORM.test(text)) return { ok: false, reason: 'platform' };
  if (g.yasak.some((desen) => desen.test(text))) return { ok: false, reason: 'yasak_kelime' };
  if (LISTE.test(text)) return { ok: false, reason: 'liste' };
  if (eslesmeSayisi(text, g.yabanciDil) >= 2) return { ok: false, reason: 'ingilizce' };
  if (sizintiVar(text, systemPrompt, paket.buyukKucukHarf)) return { ok: false, reason: 'sizinti' };

  // Son kapi: gercek gonderim yolunun kullandigi sema (1-2000 karakter + HTML reddi).
  const parsed = sendMessageSchema.safeParse({ content: text });
  if (!parsed.success) return { ok: false, reason: 'schema' };

  return { ok: true, text };
}
