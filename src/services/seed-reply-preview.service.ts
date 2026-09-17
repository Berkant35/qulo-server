import { supabase } from '../config/supabase.js';
import { buildPersonaCard, personaGirdisi } from './seed-persona.js';
import { generateSeedReply, type LlmTurn } from './seed-llm.service.js';
import { validateReply } from './seed-reply-guard.js';
import { isBusy } from './seed-reply-timing.js';
import type { SeedPersona } from '../types/seed-persona.js';

/**
 * Admin "Seed AI deneme" ekraninin servisi: gercek persona kartini kurar, gercek modele
 * sorar, gercek denetimden gecirir — ama HICBIR SEY YAZMAZ (mesaj, kuyruk, last_seen yok).
 * Amac tonu deneme-yanilma ile ayarlamak; eslesme kurup cron beklemeden.
 */

export interface DenemeIstegi {
  seedUserId: string;
  /** Sirali sohbet: 'insan' karsi taraf, 'seed' botun kendi onceki mesaji. */
  turns: Array<{ kim: 'insan' | 'seed'; text: string }>;
  phase?: 1 | 2 | 3 | 4;
  busyNow?: boolean;
  partnerClosing?: boolean;
}

export interface DenemeSonucu {
  kart: string;
  ham: string;
  metin: string | null;
  elendi: string | null;
  persona: SeedPersona;
  profil: { id: string; name: string; age: number | null; city: string | null; gender: string | null; job: string | null };
  tokenler: { giris: number; cikis: number };
}

const VARSAYILAN_PERSONA: SeedPersona = {
  responder_type: 'normal', work_pattern: 'esnek',
  sleep_window: { start_min: 30, end_min: 450 },
  style: { uzunluk: 'kisa', emoji: 'nadiren', yazim: 'gevsek', enerji: 'soru_soran' },
  derived_at: '', model: 'fallback',
};

export class DenemeHatasi extends Error {}

export async function previewSeedReply(istek: DenemeIstegi): Promise<DenemeSonucu> {
  const { data: seed } = await supabase
    .from('users')
    .select('id, name, age, city, bio, gender, relationship_goal, is_seed_profile, seed_persona')
    .eq('id', istek.seedUserId)
    .maybeSingle();
  if (!seed) throw new DenemeHatasi('Profil bulunamadi');
  if (!seed.is_seed_profile) throw new DenemeHatasi('Bu profil seed degil — deneme yalniz seed profillerde calisir');

  const { data: detay } = await supabase
    .from('user_details').select('job, personality, pets, music_type, smoking, alcohol')
    .eq('user_id', istek.seedUserId).maybeSingle();

  const persona = (seed.seed_persona as SeedPersona | null) ?? VARSAYILAN_PERSONA;
  const simdi = new Date();
  const kart = buildPersonaCard(personaGirdisi(seed, detay ?? null, {
    persona,
    phase: istek.phase ?? 1,
    busyNow: istek.busyNow ?? isBusy(persona, simdi),
    partnerClosing: istek.partnerClosing ?? false,
  }));

  const turns: LlmTurn[] = istek.turns.map((t) => ({
    role: t.kim === 'seed' ? 'model' : 'user',
    text: t.text,
  }));

  const cevap = await generateSeedReply({ system: kart, turns });
  const denetim = validateReply(cevap.text, kart);

  return {
    kart,
    ham: cevap.text,
    metin: denetim.ok ? denetim.text : null,
    elendi: denetim.ok ? null : denetim.reason,
    persona,
    profil: {
      id: String(seed.id), name: String(seed.name ?? ''), age: (seed.age as number) ?? null,
      city: (seed.city as string) ?? null, gender: (seed.gender as string) ?? null,
      job: (detay?.job as string) ?? null,
    },
    tokenler: { giris: cevap.inputTokens, cikis: cevap.outputTokens },
  };
}
