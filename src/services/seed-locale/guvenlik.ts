import { TUM_PAKETLER } from './paketler.js';
import type { SeedLocalePack } from './types.js';

/**
 * Seed botunun guvenlik kapilari (kriz, 18 yas alti) — DILDEN BAGIMSIZ ve FAIL-CLOSED.
 *
 * Neden (guvenlik incelemesi, 2026-10-13): kapilar yalniz seed'in dil paketiyle calisinca
 * Italyan seed'e Turkce yazilan kriz mesaji ve TR seed'e Italyanca yazilan yas beyani kaciyordu.
 * Insan seed'e her zaman seed'in dilinde yazmaz. Kural: her mesaj TUM paketlerin ifadeleri +
 * temel Ingilizce ile, normalize metin uzerinde sinanir; TR'nin 2026-10-13 oncesi ham desenleri de
 * ham metinde calisir (eski her "true" true kalir). Biri tutarsa kapi kapanir. Bilinmeyen/bos
 * locale de ayni birlesimden gecer. Yanlis pozitif kabul (bot susar ya da nazik kriz cevabi yazar);
 * yanlis negatif edilmez. Kapanis sinyali guvenlik degil — paket ozel (`SeedLocalePack.kapanis`).
 */

/** Sifir genislikli / yon / yumusak tire karakterleri (denetim kopyasindan atilir): "i\u200Bntihar" kacmasin. */
export const GORUNMEZ = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF]/g;

/** Varyasyon secici + tus kapagi ("3\uFE0F\u20E3"): yalniz DENETIM kopyasindan atilir (emoji gorunumu bozulmasin). */
export const VARYASYON = /[\uFE00-\uFE0F\u20E3]/g;

/** Paketi olmayan ama her mesajda uygulanan temel Ingilizce (turist / karisik dil). */
const INGILIZCE = {
  krizIfadeleri: [
    'kill myself', 'killing myself', 'want to die', 'wanna die', 'end my life', 'end it all', 'self harm',
    'hurt myself', 'cut myself', 'suicid', 'unalive', 'don ?t want to live', String.raw`(?<!\d\s?)\bkms\b`,
  ],
  yasAltiDesenleri: [
    String.raw`\bi\s*a?m\s+(?:only\s+|just\s+)?1[0-7]\b(?!\s*(?:mins?|minutes?|hours?|days?|km|kg|cm|euros?|dollars?|percent|th|st|nd|rd)\b)`,
    String.raw`\b1[0-7]\s*(?:years?\s*old|yrs?\s*old|yo)\b`,
    String.raw`\bunder\s*(?:age|18)\b`,
    // "i m a minor" harf birlestirmesiyle "ima minor" olur.
    String.raw`\bi\s*a?m\s*a?\s*minor\b`,
    String.raw`\b(?:i\s*a?m\s+)?not\s+18\b`,
  ],
  dogumYiliDesenleri: [String.raw`\bborn\s+in\s+(20\d\d)\b`],
  sayiKelimeleri: [
    [String.raw`\bten\b`, '10'], [String.raw`\beleven\b`, '11'], [String.raw`\btwelve\b`, '12'],
    [String.raw`\bthirteen\b`, '13'], [String.raw`\bfourteen\b`, '14'], [String.raw`\bfifteen\b`, '15'],
    [String.raw`\bsixteen\b`, '16'], [String.raw`\bseventeen\b`, '17'], [String.raw`\beighteen\b`, '18'],
  ] as ReadonlyArray<readonly [string, string]>,
};

interface DilDesenleri { dil: string; kriz: RegExp; yasAlti: RegExp; dogumYili: RegExp[]; hamKriz?: RegExp; hamYasAlti?: RegExp }

/** Ifade → desen: duz bosluk `\s*` olur ("vogliomorire" bitisik yazimi da tutar). */
function ifadeDeseni(ifadeler: readonly string[]): RegExp {
  return new RegExp(`(?:${ifadeler.map((i) => `(?:${i.replace(/ /g, String.raw`\s*`)})`).join('|')})`);
}

const DIL_DESENLERI: readonly DilDesenleri[] = [
  ...TUM_PAKETLER.map((p) => ({
    dil: p.locale,
    kriz: new RegExp(String.raw`\b` + ifadeDeseni(p.guvenlik.krizIfadeleri).source),
    yasAlti: new RegExp(p.guvenlik.yasAltiDesenleri.join('|')),
    dogumYili: p.guvenlik.dogumYiliDesenleri.map((d) => new RegExp(d)),
    hamKriz: p.guvenlik.ham?.kriz,
    hamYasAlti: p.guvenlik.ham?.yasAlti,
  })),
  {
    dil: 'en',
    kriz: new RegExp(String.raw`\b` + ifadeDeseni(INGILIZCE.krizIfadeleri).source),
    yasAlti: new RegExp(INGILIZCE.yasAltiDesenleri.join('|')),
    dogumYili: INGILIZCE.dogumYiliDesenleri.map((d) => new RegExp(d)),
  },
];

/** Yaziyla sayilar → rakam; tum dillerin listesi her mesaja uygulanir (bilesik TR sayilar once). */
const SAYI_KELIMELERI: ReadonlyArray<readonly [RegExp, string]> = [
  ...TUM_PAKETLER.flatMap((p) => p.guvenlik.sayiKelimeleri),
  ...INGILIZCE.sayiKelimeleri,
].map(([desen, rakam]) => [new RegExp(desen, 'g'), rakam] as const);

/**
 * Normalize varyantlar: gorunmez karakter temizligi, NFKD (tam genislik "１６" → "16", aksan
 * ayrisir) + aksan sokme, kucuk harf (yerel ayarsiz + TR İ/I/ı → i), noktalama → bosluk, bosluk
 * sikistirma, harf harf ayrik yazimin birlestirilmesi ("m o r i r e"), yaziyla sayi → rakam,
 * ayrik rakam birlestirme ("1 6" → "16"). Uc+ tekrar eden harf iki varyantla: "annnni" → "anni"
 * (ikiye), "morireeee" → "morire" (bire).
 */
export function guvenlikVaryantlari(text: string): string[] {
  let s = text.replace(GORUNMEZ, '').replace(VARYASYON, '');
  s = s.replace(/[İI]/g, 'i').replace(/ı/g, 'i');
  s = s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  s = s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  s = s.replace(/(?<![\p{L}\p{N}])\p{L}(?: \p{L}(?![\p{L}\p{N}]))+/gu, (m) => m.replace(/ /g, ''));
  for (const [desen, rakam] of SAYI_KELIMELERI) s = s.replace(desen, rakam);
  s = s.replace(/(\d)\s+(?=\d)/g, '$1');
  const iki = s.replace(/(\p{L})\1{2,}/gu, '$1$1');
  const bir = s.replace(/(\p{L})\1{2,}/gu, '$1');
  return iki === bir ? [iki] : [iki, bir];
}

/** Dogum yili beyani: yil >= (bu yil - 18) → yas alti sayilir (sinirda olan da; fail-closed). */
function dogumYiliYasAlti(varyant: string, desenler: readonly RegExp[], simdi: Date): boolean {
  const esik = simdi.getUTCFullYear() - 18;
  return desenler.some((d) => {
    const yil = Number(d.exec(varyant)?.[1]);
    return Number.isFinite(yil) && yil >= esik && yil <= simdi.getUTCFullYear();
  });
}

/** Kriz sinyalinin yakalandigi diller (paket dilleri + 'en'). Bos = kriz yok. */
export function krizDilleri(text: string): Set<string> {
  const varyantlar = guvenlikVaryantlari(text);
  const diller = new Set<string>();
  for (const d of DIL_DESENLERI) {
    if (d.hamKriz?.test(text) || varyantlar.some((v) => d.kriz.test(v))) diller.add(d.dil);
  }
  return diller;
}

/** Kendine zarar / intihar sinyali — hangi dilde yazilmis olursa olsun. */
export function krizSinyali(text: string): boolean {
  return krizDilleri(text).size > 0;
}

/** 18 yas alti beyani — hangi dilde yazilmis olursa olsun (dogum yili dahil). */
export function yasAltiBeyani(text: string, simdi: Date = new Date()): boolean {
  const varyantlar = guvenlikVaryantlari(text);
  return DIL_DESENLERI.some((d) =>
    d.hamYasAlti?.test(text) ||
    varyantlar.some((v) => d.yasAlti.test(v) || dogumYiliYasAlti(v, d.dogumYili, simdi)));
}

/**
 * Kriz varsa sabit (LLM'siz) cevap, yoksa null. Mesaj seed'in dilinde (ya da yalniz Ingilizce
 * desenle) yakalandiysa seed'in dilinde; baska bir paketin dilinde yakalandiysa O dilde —
 * Italyan seed'e Turkce yazan biri buyuk olasilikla Turkiye'dedir, Turkiye'nin acil numarasini gormeli.
 */
export function krizCevabi(text: string, seedPaketi: SeedLocalePack): string | null {
  const diller = krizDilleri(text);
  if (diller.size === 0) return null;
  if (diller.has(seedPaketi.locale)) return seedPaketi.guvenlik.krizCevabi;
  const baska = TUM_PAKETLER.find((p) => diller.has(p.locale));
  return (baska ?? seedPaketi).guvenlik.krizCevabi;
}
