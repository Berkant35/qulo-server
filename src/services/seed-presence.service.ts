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
 *
 * Son gorulme GERI GITMEZ. `presenceFor` her tikte bagimsiz bir "kac dk once" cekiyor;
 * bu deger dogrudan yazilinca ayni profile art arda bakan kullanici
 * "2 saat once goruldu" -> "10 dk once goruldu" ziplamasini goruyordu (gercek hayatta
 * son gorulme yalnizca ileri gider). Bu yuzden alan yalnizca profil CEVRIMICI oldugunda
 * `now` ile tazelenir; cevrimdisi iken sabit kalir ve kendiliginden yaslanir — gercek
 * presence semantigi, heartbeat de boyle calisir. `gorulmeDk` artik sadece hic degeri
 * olmayan / bayat profillerin tek seferlik tohumlanmasinda kullanilir.
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

/** Son gorulmesi hic yazilmamis ya da bu kadar bayatlamis profil bir kez tohumlanir. */
const TOHUM_ESIGI_MS = 12 * 60 * 60_000;

async function topluYaz(idler: string[], patch: Record<string, unknown>): Promise<number> {
  for (let i = 0; i < idler.length; i += ID_PARCA) {
    const { error } = await supabase.from('users').update(patch).in('id', idler.slice(i, i + ID_PARCA));
    if (error) throw error;
  }
  return idler.length;
}

/**
 * Tum seed profillerin cevrimici/son gorulme alanlarini tazeler. Ayni duruma dusen
 * profiller tek UPDATE ile yazilir: 416 satir icin 416 istek atilmaz.
 *
 * Durumu zaten dogru olan profile DOKUNULMAZ: cevrimdisi kalan bir profilin
 * son gorulmesi sabittir, bos yere UPDATE yemez.
 */
export async function refreshSeedPresence(now: Date = new Date()): Promise<number> {
  const { data: seedler, error } = await supabase
    .from('users')
    .select('id, seed_persona, is_online, last_seen_at')
    // Yazma kapisiyla AYNI iki bayrak (`botYazabilir`): `is_test_account=false` yapilan
    // bir seed profil gercek kullanicilara acilir, o profile uydurma bir cevrimici
    // ritmi yazmak gercek bir kullaniciya sahte sinyal vermek olurdu.
    .eq('is_seed_profile', true)
    .eq('is_test_account', true);
  if (error) throw error;
  if (!seedler?.length) return 0;

  const cevrimici: string[] = [];
  const dusenler: string[] = [];
  /** Tohumlanacaklar, gorulme dakikasina gore gruplanir: ayni dakika tek UPDATE. */
  const tohum = new Map<number, string[]>();

  for (const u of seedler) {
    const id = String(u.id);
    const persona = (u.seed_persona as SeedPersona | null) ?? VARSAYILAN_PERSONA;
    const p = presenceFor(persona, id, now);

    if (p.online) { cevrimici.push(id); continue; }

    const gorulme = u.last_seen_at ? Date.parse(String(u.last_seen_at)) : NaN;
    if (Number.isNaN(gorulme) || now.getTime() - gorulme > TOHUM_ESIGI_MS) {
      const liste = tohum.get(p.gorulmeDk);
      if (liste) liste.push(id);
      else tohum.set(p.gorulmeDk, [id]);
    } else if (u.is_online) {
      dusenler.push(id);   // cevrimiciydi, artik degil — son gorulme oldugu gibi kalir
    }
  }

  let guncellenen = 0;
  guncellenen += await topluYaz(cevrimici, { is_online: true, last_seen_at: now.toISOString() });
  guncellenen += await topluYaz(dusenler, { is_online: false });
  for (const [dk, idler] of tohum) {
    guncellenen += await topluYaz(idler, {
      is_online: false,
      last_seen_at: new Date(now.getTime() - dk * 60_000).toISOString(),
    });
  }
  return guncellenen;
}
