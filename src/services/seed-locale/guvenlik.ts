import { TUM_PAKETLER } from './paketler.js';
import type { SeedLocalePack } from './types.js';

/**
 * Seed botunun guvenlik kapilari (kriz, 18 yas alti) — DILDEN BAGIMSIZ ve FAIL-CLOSED.
 *
 * Neden (guvenlik incelemesi, 2026-10-13): kapilar yalniz seed'in dil paketiyle calisinca
 * Italyan seed'e Turkce yazilan kriz mesaji ve TR seed'e Italyanca yazilan yas beyani kaciyordu.
 * Insan seed'e her zaman seed'in dilinde yazmaz. Kural: her mesaj TUM paketlerin ham desenleri
 * (ham metinde) + asagidaki normalize ifadeler (TR + IT + temel Ingilizce, normalize metinde)
 * ile sinanir; biri tutarsa kapi kapanir. Bilinmeyen/bos locale de ayni birlesimden gecer.
 * Yanlis pozitif kabul edilir (bot susar ya da nazik kriz cevabi yazar); yanlis negatif edilmez.
 *
 * Kapanis sinyali guvenlik degil — paket ozel kalir (seed-reply.service `kapanisSinyali`).
 */

type IfadeDili = 'tr' | 'it' | 'en';

/** Sifir genislikli / yon / yumusak tire karakterleri: "i\u200Bntihar" desenden kacmasin. */
export const GORUNMEZ = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/** Yaziyla sayilar → rakam (normalize metinde, aksansiz). Bilesik TR sayilar once. */
const SAYI_KELIMELERI: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bon\s*bir\b/g, '11'], [/\bon\s*iki\b/g, '12'], [/\bon\s*uc\b/g, '13'], [/\bon\s*dort\b/g, '14'],
  [/\bon\s*bes\b/g, '15'], [/\bon\s*alti\b/g, '16'], [/\bon\s*yedi\b/g, '17'], [/\bon\s*sekiz\b/g, '18'],
  [/\bon(?=\s*yas)/g, '10'],
  [/\bdieci\b/g, '10'], [/\bundici\b/g, '11'], [/\bdodici\b/g, '12'], [/\btredici\b/g, '13'],
  [/\bquattordici\b/g, '14'], [/\bquindici\b/g, '15'], [/\bsedici\b/g, '16'], [/\bdiciassette\b/g, '17'],
  [/\bdiciotto\b/g, '18'],
  [/\bten\b/g, '10'], [/\beleven\b/g, '11'], [/\btwelve\b/g, '12'], [/\bthirteen\b/g, '13'],
  [/\bfourteen\b/g, '14'], [/\bfifteen\b/g, '15'], [/\bsixteen\b/g, '16'], [/\bseventeen\b/g, '17'],
  [/\beighteen\b/g, '18'],
];

/**
 * Normalize varyantlar: gorunmez karakter temizligi, kucuk harf (yerel ayarsiz + TR İ/I/ı → i),
 * NFD ile aksan/sapka sokme (ş→s, à→a), noktalama → bosluk, bosluk sikistirma, harf harf ayrik
 * yazimin birlestirilmesi, yaziyla sayi →
 * rakam, ayrik rakam birlestirme ("1 6" → "16"). Uc+ tekrar eden harf iki varyantla:
 * "annnni" → "anni" (ikiye), "morireeee" → "morire" (bire).
 */
export function guvenlikVaryantlari(text: string): string[] {
  let s = text.replace(GORUNMEZ, '');
  s = s.replace(/[İI]/g, 'i').toLowerCase().replace(/ı/g, 'i');
  s = s.normalize('NFD').replace(/\p{M}/gu, '');
  s = s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  // Harf harf ayrik yazim ("m o r i r e", "h o 1 6 anni"): ardisik tek harfli kelimeler birlestirilir.
  s = s.replace(/(?<![\p{L}\p{N}])\p{L}(?: \p{L}(?![\p{L}\p{N}]))+/gu, (m) => m.replace(/ /g, ''));
  for (const [desen, rakam] of SAYI_KELIMELERI) s = s.replace(desen, rakam);
  s = s.replace(/(\d)\s+(?=\d)/g, '$1');
  const iki = s.replace(/(\p{L})\1{2,}/gu, '$1$1');
  const bir = s.replace(/(\p{L})\1{2,}/gu, '$1');
  return iki === bir ? [iki] : [iki, bir];
}

/** Ifade listesi → desen: kelime araliklari bitisik yazimi da tutar ("vogliomorire"). */
function ifadeDeseni(ifadeler: readonly string[]): RegExp {
  const kacis = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b(?:${ifadeler.map((i) => i.split(' ').map(kacis).join('\\s*')).join('|')})`);
}

/** Normalize metin uzerinde (aksansiz, kucuk harf) kriz ifadeleri. */
const KRIZ_NORMAL: Record<IfadeDili, RegExp> = {
  tr: ifadeDeseni([
    'yasamak istemiyorum', 'intihar', 'kendime zarar', 'canima kiy', 'olmek istiyorum', 'yasamaktan biktim',
    'kendimi oldur', 'hayatima son ver',
  ]),
  it: ifadeDeseni([
    'voglio morire', 'vorrei morire', 'farla finita', 'non voglio piu vivere', 'non ce la faccio piu a vivere',
    'non ha piu senso vivere', 'non ha senso vivere', 'stanco di vivere', 'stanca di vivere', 'togliermi la vita',
    'suicid', 'uccidermi', 'ammazzarmi', 'farmi del male', 'mi faccio del male', 'autolesion',
    'tagliarmi le vene', 'tagliarmi i polsi', 'mi taglio le vene', 'mi taglio i polsi', 'meglio se muoio',
    'meglio morto', 'meglio morta',
  ]),
  en: ifadeDeseni([
    'kill myself', 'killing myself', 'want to die', 'wanna die', 'end my life', 'self harm', 'hurt myself',
    'cut myself', 'suicid',
  ]),
};

/** Normalize metin uzerinde 18 yas alti beyanlari (yaziyla sayilar rakama cevrilmis). */
const YAS_NORMAL: Record<IfadeDili, RegExp> = {
  tr: new RegExp([
    String.raw`\b1[0-7]\s*yas(?:inda|indayim|indaydim|im)?\b`,
    String.raw`\byasim\s*1[0-7]\b`,
    String.raw`\bresit\s*degil(?:im)?\b`,
  ].join('|')),
  it: new RegExp([
    String.raw`\bho\s*(?:solo\s+|appena\s+|quasi\s+)?(?:1[0-7]|[1-9])\s*anni\b(?!\s+(?:di|da|che|fa|in|piu)\b)`,
    String.raw`\bho\s+quasi\s+18\s*anni\b`,
    String.raw`\b(?:compio|faccio)\s*1[0-8]\s*anni\b(?!\s+(?:di|da|che|fa|in)\b)`,
    String.raw`\b1[0-7]\s*enne\b`,
    String.raw`(?<!\bnon\s)\bsono\s+(?:ancora\s+)?(?:una?\s+)?minorenne\b`,
    String.raw`^1[0-7]\s*anni$`,
  ].join('|')),
  en: new RegExp([
    String.raw`\bi\s*a?m\s+(?:only\s+|just\s+)?1[0-7]\b(?!\s*(?:mins?|minutes?|hours?|days?|km|kg|cm|euros?|dollars?|percent|th|st|nd|rd)\b)`,
    String.raw`\b1[0-7]\s*(?:years?\s*old|yrs?\s*old|yo)\b`,
    String.raw`\bunder\s*age\b`,
  ].join('|')),
};

const IFADE_DILLERI = Object.keys(KRIZ_NORMAL) as IfadeDili[];

/** Mesajin hangi dillerin desenine takildigi: paket ham desenleri + normalize ifadeler. */
function eslesenDiller(
  text: string,
  ham: (p: SeedLocalePack) => RegExp,
  normal: Record<IfadeDili, RegExp>,
): Set<string> {
  const diller = new Set<string>();
  for (const p of TUM_PAKETLER) if (ham(p).test(text)) diller.add(p.locale);
  const varyantlar = guvenlikVaryantlari(text);
  for (const dil of IFADE_DILLERI) if (varyantlar.some((v) => normal[dil].test(v))) diller.add(dil);
  return diller;
}

/** Kendine zarar / intihar sinyali — hangi dilde yazilmis olursa olsun. */
export function krizSinyali(text: string): boolean {
  return eslesenDiller(text, (p) => p.guvenlik.kriz, KRIZ_NORMAL).size > 0;
}

/** 18 yas alti beyani — hangi dilde yazilmis olursa olsun. */
export function yasAltiBeyani(text: string): boolean {
  return eslesenDiller(text, (p) => p.guvenlik.yasAlti, YAS_NORMAL).size > 0;
}

/**
 * Kriz cevabi (LLM'siz, sabit): mesaj seed'in dilinde (ya da yalniz Ingilizce desenle)
 * yakalandiysa seed'in dilinde; baska bir paketin dilinde yakalandiysa O dilde — Italyan seed'e
 * Turkce yazan biri buyuk olasilikla Turkiye'dedir ve Turkiye'nin acil numarasini gormeli.
 */
export function krizCevabi(text: string, seedPaketi: SeedLocalePack): string {
  const diller = eslesenDiller(text, (p) => p.guvenlik.kriz, KRIZ_NORMAL);
  if (diller.has(seedPaketi.locale)) return seedPaketi.guvenlik.krizCevabi;
  const baska = TUM_PAKETLER.find((p) => diller.has(p.locale));
  return (baska ?? seedPaketi).guvenlik.krizCevabi;
}

/** Normalize ifadesi olan diller — her paketin dili burada olmali (test: yeni paket unutulmasin). */
export const GUVENLIK_IFADE_DILLERI: readonly string[] = IFADE_DILLERI;
