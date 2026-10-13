import { createHash } from 'node:crypto';
import type { Mesafe, PersonaCardInput, ResponderType, SeedPersona, SeedStyle } from '../types/seed-persona.js';
import {
  DISA_DONUK_ETIKETLERI, ICE_DONUK_ETIKETLERI, TR_PAKETI, kisilikAnahtari, seedLocalePack, type SeedLocalePack,
} from './seed-locale/index.js';

const EKSENLER = {
  uzunluk: ['tek_cumle', 'kisa', 'orta'],
  emoji: ['yok', 'nadiren', 'sik'],
  yazim: ['gevsek', 'kucuk_harf', 'ozenli'],
  enerji: ['soru_soran', 'kisa_kesen', 'dagitan'],
} as const;

function bucket(seedId: string, eksen: string, n: number): number {
  const h = createHash('sha1').update(`${seedId}:${eksen}`).digest('hex');
  return parseInt(h.slice(0, 8), 16) % n;
}

export function styleFor(seedId: string): SeedStyle {
  return {
    uzunluk: EKSENLER.uzunluk[bucket(seedId, 'uzunluk', 3)]!,
    emoji: EKSENLER.emoji[bucket(seedId, 'emoji', 3)]!,
    yazim: EKSENLER.yazim[bucket(seedId, 'yazim', 3)]!,
    enerji: EKSENLER.enerji[bucket(seedId, 'enerji', 3)]!,
  } as SeedStyle;
}

export function responderTypeFor(seedId: string, personality: string | null): ResponderType {
  // Disa donuk daha hizli cevaplar; en yavas tip havuzdan cikarilir. Etiketler tum dil
  // paketlerinden (derive hatti seed'in dilini bilmeden cagirir).
  const etiket = personality != null ? kisilikAnahtari(personality) : null;
  const havuz: ResponderType[] = etiket != null && DISA_DONUK_ETIKETLERI.has(etiket)
    ? ['anlik', 'anlik', 'normal', 'duzensiz']
    : etiket != null && ICE_DONUK_ETIKETLERI.has(etiket)
      ? ['normal', 'gec', 'gec', 'duzensiz']
      : ['anlik', 'normal', 'normal', 'gec'];
  return havuz[bucket(seedId, 'responder', havuz.length)]!;
}

/** Ton dagilimi dil paketinde (gerekce orada: TR'de mesafeliye kaydirilmis kadin dagilimi). */
export function mesafeFor(seedKey: string, gender: string | null, paket: SeedLocalePack = TR_PAKETI): Mesafe {
  const havuz = gender === 'WOMAN' ? paket.mesafeHavuzu.kadin : paket.mesafeHavuzu.diger;
  return havuz[bucket(seedKey, 'mesafe', havuz.length)]!;
}

export interface SeedProfilSatiri {
  id?: unknown; name?: unknown; age?: unknown; city?: unknown; bio?: unknown;
  gender?: unknown; relationship_goal?: unknown;
  /** `users.locale` — dil paketi anahtari (seedLocalePack). */
  locale?: unknown;
}
export interface SeedDetaySatiri {
  job?: unknown; personality?: unknown; pets?: unknown;
  music_type?: unknown; smoking?: unknown; alcohol?: unknown;
}

/** DB satirlarindan kart girdisi. Uretim akisi ile admin deneme ekrani AYNI karti gorsun. */
export function personaGirdisi(
  seed: SeedProfilSatiri,
  detay: SeedDetaySatiri | null,
  opts: { persona: SeedPersona; phase: 1 | 2 | 3 | 4; busyNow: boolean; partnerClosing?: boolean; mediaAsk?: boolean },
): PersonaCardInput {
  return {
    seedKey: String(seed.id ?? ''),
    gender: (seed.gender as 'WOMAN' | 'MAN' | null) ?? null,
    name: String(seed.name ?? ''), age: Number(seed.age ?? 30),
    district: (seed.city as string) ?? null, province: null,
    bio: (seed.bio as string) ?? null, job: (detay?.job as string) ?? null,
    personality: (detay?.personality as string) ?? null, pets: (detay?.pets as string) ?? null,
    musicType: (detay?.music_type as string) ?? null, smoking: (detay?.smoking as string) ?? null,
    alcohol: (detay?.alcohol as string) ?? null,
    relationshipGoal: (seed.relationship_goal as string) ?? null,
    locale: (seed.locale as string) ?? null,
    persona: opts.persona, phase: opts.phase, busyNow: opts.busyNow,
    partnerClosing: opts.partnerClosing ?? false,
    mediaAsk: opts.mediaAsk ?? false,
  };
}

/**
 * Persona karti v2. v1 altmis satir KURAL'di ve model "kurallara uyan" bir ses uretiyordu
 * (kullanici geri bildirimi: "cok fake kokuyor"). v2 once ORNEK gosterir: gercek mesaj
 * ornekleri + canli dokumden alinmis kotu ornekler, sonra sayisal olcuu, en sonda tavir.
 * Iskelet dilden bagimsiz; metinler seed'in dil paketinden (`users.locale`, TR geri donus).
 */
export function buildPersonaCard(i: PersonaCardInput): string {
  const paket = seedLocalePack(i.locale);
  const k = paket.kart;
  const s = i.persona.style;
  const ornekler = [...k.ornekler[s.yazim]];
  if (s.emoji === 'sik') { ornekler[1] += ' 🙂'; ornekler[5] += ' 😄'; }
  else if (s.emoji === 'nadiren') { ornekler[5] += ' 🙂'; }

  return [
    ...k.kimlik(i),
    '',
    k.ornekBaslik,
    ...ornekler.map((o) => `    ${o}`),
    '',
    k.kotuBaslik,
    ...k.kotuOrnekler.map((o) => `    ${o}`),
    '',
    k.olculerBaslik,
    `- ${k.tavan[s.uzunluk]}${k.bicimYasagi}`,
    k.uzunlukKurali,
    `- ${k.emoji[s.emoji]}`,
    `- ${k.soru[s.enerji]}${k.soruArdArda}`,
    ...k.olcuSonu,
    '',
    k.tavirBaslik,
    ...k.mesafe[mesafeFor(i.seedKey, i.gender, paket)].map((m) => `- ${m}`),
    '',
    k.hakkindaBaslik,
    ...k.olgular(i).map((o) => `- ${o}`),
    '',
    k.yapmadiklarinBaslik,
    ...k.yapmadiklarin,
    '',
    k.suAnBaslik,
    `- ${k.faz[i.phase]}`,
    ...(i.busyNow ? [k.mesgul] : []),
    ...(i.partnerClosing ? [k.kapanis] : []),
    ...(i.mediaAsk ? k.medya : []),
    '',
    ...k.kriz,
    '',
    k.sonHatirlatma,
  ].join('\n');
}
