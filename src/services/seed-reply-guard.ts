import { sendMessageSchema } from '../validators/chat.validator.js';
import { GORUNMEZ, TR_PAKETI, TUM_PAKETLER, VARYASYON, type SeedLocalePack } from './seed-locale/index.js';

export type GuardReason =
  | 'bos' | 'schema' | 'uzunluk' | 'iletisim' | 'platform' | 'yasak_kelime' | 'liste' | 'ingilizce' | 'sizinti';

export type GuardResult = { ok: true; text: string } | { ok: false; reason: GuardReason };

/** Bir insan mesaji bu uzunlugu asmaz; asan cikti LLM'i ele verir. */
const MAX_KARAKTER = 300;

// Iletisim ve ele veren kelime desenleri TUM paketlerin birlesimi (inceleme 2026-10-13): Italyan
// seed Turk numarasi, TR seed +39 numara yazamamali. Yabanci dil isareti ve buyuk/kucuk harf
// kurallari seed'in kendi paketinden (TR seed'de "İngilizce", IT seed'de Ingilizce + Turkce harf).
const TELEFONLAR: readonly RegExp[] = TUM_PAKETLER.map((p) => p.guard.telefon);
const YASAKLAR: readonly RegExp[] = TUM_PAKETLER.flatMap((p) => p.guard.yasak);
const HESAP = /@[A-Za-z0-9._]{3,}|https?:\/\/|www\.|\b[\w.-]+@[\w.-]+\.\w{2,}\b|\bt\.me\/|\big\s*:\s*@?[A-Za-z0-9._]{3,}/i;

/**
 * Kartta ve kriz cevabinda verilen yardim hatlari (ör. Telefono Amico 02 2327 2327) telefon sayilmaz:
 * kriz kapisi bir ifadeyi kacirip model kartindaki numarayi yazarsa, yardimi guard engellemesin.
 * 6+ haneli olanlar; ayiricilar serbest. Denetimden once metinden cikarilir.
 */
const YARDIM_HATLARI: RegExp | null = (() => {
  const desenler = [...new Set(TUM_PAKETLER.flatMap((p) => p.guvenlik.yardimHatlari))]
    .map((h) => h.replace(/\D/g, ''))
    .filter((rakam) => rakam.length >= 6)
    .map((rakam) => rakam.split('').join(String.raw`[\s.\-/,_()]*`));
  return desenler.length ? new RegExp(String.raw`(?<!\d)(?:${desenler.join('|')})(?!\d)`, 'g') : null;
})();
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
  if (!text) return { ok: false, reason: 'bos' };
  if (text.length > MAX_KARAKTER) return { ok: false, reason: 'uzunluk' };
  // Denetim kopyasi: gorunmez karakter + varyasyon secici/tus kapagi atilir, NFKC tam genislik ve
  // matematik rakamlarini ASCII'ye katlar. Gonderilen metin degismez (emoji dizileri bozulmasin).
  const denetim = text.replace(GORUNMEZ, '').replace(VARYASYON, '').normalize('NFKC');
  const yardimsiz = YARDIM_HATLARI ? denetim.replace(YARDIM_HATLARI, ' ') : denetim;
  if (TELEFONLAR.some((desen) => desen.test(yardimsiz)) || HESAP.test(denetim)) return { ok: false, reason: 'iletisim' };
  if (PLATFORM.test(denetim)) return { ok: false, reason: 'platform' };
  if (YASAKLAR.some((desen) => desen.test(denetim))) return { ok: false, reason: 'yasak_kelime' };
  if (LISTE.test(text)) return { ok: false, reason: 'liste' };
  if (eslesmeSayisi(text, paket.guard.yabanciDil) >= 2) return { ok: false, reason: 'ingilizce' };
  if (sizintiVar(text, systemPrompt, paket.buyukKucukHarf)) return { ok: false, reason: 'sizinti' };

  // Son kapi: gercek gonderim yolunun kullandigi sema (1-2000 karakter + HTML reddi).
  const parsed = sendMessageSchema.safeParse({ content: text });
  if (!parsed.success) return { ok: false, reason: 'schema' };

  return { ok: true, text };
}
