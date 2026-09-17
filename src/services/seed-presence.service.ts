import { createHash } from 'node:crypto';
import { supabase } from '../config/supabase.js';
import { isBusy, isSleeping } from './seed-reply-timing.js';
import type { SeedPersona } from '../types/seed-persona.js';

/**
 * Seed profillerin "cevrimici / son gorulme" ritmi.
 *
 * Neden: `is_online` yalniz giris-cikista, `last_seen_at` ise yalniz bot mesaj yazarken
 * guncelleniyordu. Seed profiller giris YAPAMAZ (auth.service: is_seed_profile ->
 * INVALID_CREDENTIALS), bu yuzden 416 profilin 410'u "5 gun once goruldu" diye duruyordu.
 * Canli cevap yazan biri icin bu tek basina ele veren bir celiski (kullanici geri bildirimi).
 *
 * Ritim persona'dan turetilir: uyku penceresi, calisma deseni, cevaplayici tipi.
 * Deterministik — ayni tik icinde ayni sonuc — ama tikten tike degisir.
 */

const VARSAYILAN_PERSONA: SeedPersona = {
  responder_type: 'normal', work_pattern: 'esnek',
  sleep_window: { start_min: 30, end_min: 450 },
  style: { uzunluk: 'kisa', emoji: 'nadiren', yazim: 'gevsek', enerji: 'soru_soran' },
  derived_at: '', model: 'fallback',
};

/** Cevrimici olma olasiligi: anlik cevaplayan biri gercekten de daha sik cevrimicidir. */
const ONLINE_ORANI: Record<SeedPersona['responder_type'], number> = {
  anlik: 0.30, normal: 0.18, duzensiz: 0.14, gec: 0.08,
};

/** Tik penceresi: ayni 5 dakika icinde durum sabit, sonra yeniden cekilir. */
const TIK_MS = 5 * 60_000;

function kova(seedKey: string, salt: string): number {
  const h = createHash('sha1').update(`${seedKey}:${salt}`).digest('hex').slice(0, 8);
  return (parseInt(h, 16) % 10_000) / 10_000;   // [0,1)
}

export interface SeedPresence {
  online: boolean;
  /** Kac dakika once goruldu (online ise 0). 5'in katina yuvarlanir: toplu guncelleme icin. */
  gorulmeDk: number;
}

export function presenceFor(persona: SeedPersona, seedKey: string, now: Date): SeedPresence {
  const dilim = Math.floor(now.getTime() / TIK_MS);
  const r = kova(seedKey, `presence-${dilim}`);
  const yuvarla = (dk: number) => Math.max(5, Math.round(dk / 5) * 5);

  // Uykudayken kimse cevrimici degil; son gorulme uykuya girise dogru kayar.
  if (isSleeping(persona, now)) {
    return { online: false, gorulmeDk: yuvarla(180 + r * 300) };
  }

  // Mesai/vardiya: telefona nadiren bakilir.
  if (isBusy(persona, now)) {
    if (r < 0.05) return { online: true, gorulmeDk: 0 };
    return { online: false, gorulmeDk: yuvarla(r < 0.45 ? 30 + r * 60 : 90 + r * 180) };
  }

  const p = ONLINE_ORANI[persona.responder_type] ?? 0.15;
  if (r < p) return { online: true, gorulmeDk: 0 };
  if (r < p + 0.35) return { online: false, gorulmeDk: yuvarla(5 + r * 25) };
  if (r < p + 0.70) return { online: false, gorulmeDk: yuvarla(25 + r * 65) };
  return { online: false, gorulmeDk: yuvarla(90 + r * 210) };
}

/** PostgREST URL siniri: id listesi tek sorguya konmaz (bkz. discover olayi 2026-09-17). */
const ID_PARCA = 100;

/**
 * Tum seed profillerin cevrimici/son gorulme alanlarini tazeler. Ayni duruma dusen
 * profiller tek UPDATE ile yazilir: 416 satir icin 416 istek atilmaz.
 */
export async function refreshSeedPresence(now: Date = new Date()): Promise<number> {
  const { data: seedler, error } = await supabase
    .from('users')
    .select('id, seed_persona')
    .eq('is_seed_profile', true);
  if (error) throw error;
  if (!seedler?.length) return 0;

  // Anahtar: `online` ya da gorulme dakikasi. Ayni anahtardakiler tek sorguda guncellenir.
  const gruplar = new Map<string, string[]>();
  for (const u of seedler) {
    const persona = (u.seed_persona as SeedPersona | null) ?? VARSAYILAN_PERSONA;
    const p = presenceFor(persona, String(u.id), now);
    const anahtar = p.online ? 'online' : String(p.gorulmeDk);
    const liste = gruplar.get(anahtar);
    if (liste) liste.push(String(u.id));
    else gruplar.set(anahtar, [String(u.id)]);
  }

  let guncellenen = 0;
  for (const [anahtar, idler] of gruplar) {
    const online = anahtar === 'online';
    const gorulme = new Date(now.getTime() - (online ? 0 : Number(anahtar) * 60_000)).toISOString();
    for (let i = 0; i < idler.length; i += ID_PARCA) {
      const { error: guncelleHatasi } = await supabase
        .from('users')
        .update({ is_online: online, last_seen_at: gorulme })
        .in('id', idler.slice(i, i + ID_PARCA));
      if (guncelleHatasi) throw guncelleHatasi;
      guncellenen += Math.min(ID_PARCA, idler.length - i);
    }
  }
  return guncellenen;
}
