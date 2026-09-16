import { supabase } from '../config/supabase.js';
import { computeReplyDelayMs, isBusy } from './seed-reply-timing.js';
import type { SeedPersona } from '../types/seed-persona.js';
import { chatService } from './chat.service.js';
import { buildPersonaCard } from './seed-persona.js';
import { validateReply } from './seed-reply-guard.js';
import { generateSeedReply } from './seed-llm.service.js';

export interface QueueRow {
  id: string;
  match_id: string;
  seed_user_id: string;
  trigger_message_id: string | null;
  question_id: string | null;
  kind: 'message' | 'question' | 'question_answer';
  reply_due_at: string;
  status: string;
  attempts: number;
}

const VARSAYILAN_PERSONA: SeedPersona = {
  responder_type: 'normal', work_pattern: 'esnek',
  sleep_window: { start_min: 30, end_min: 450 },
  style: { uzunluk: 'kisa', emoji: 'nadiren', yazim: 'gevsek', enerji: 'soru_soran' },
  derived_at: '', model: 'fallback',
};

async function fastModeAcik(): Promise<boolean> {
  const { data } = await supabase.from('app_config').select('seed_reply_fast_mode').limit(1).maybeSingle();
  return Boolean(data?.seed_reply_fast_mode);
}

export function fazFor(messageCount: number): 1 | 2 | 3 | 4 {
  if (messageCount <= 10) return 1;
  if (messageCount <= 15) return 2;
  if (messageCount <= 24) return 3;
  return 4;
}

/** PostgREST sorgusu URL'de gidiyor: 416 seed icin tek bir .or() ifadesi ~42 KB olurdu
 *  (yaygin sunucu siniri ~8-16 KB). Parcali .in() hem sinirin altinda kaliyor hem
 *  fake-supabase'in destekledigi bicim. */
const ID_PARCA = 100;

async function seedEslesmeleri(seedIds: string[]) {
  const bulunan = new Map<string, { id: string; user1_id: string; user2_id: string }>();
  for (const kolon of ['user1_id', 'user2_id'] as const) {
    for (let i = 0; i < seedIds.length; i += ID_PARCA) {
      const { data } = await supabase
        .from('matches')
        .select('id, user1_id, user2_id')
        .eq('is_active', true)
        .in(kolon, seedIds.slice(i, i + ID_PARCA));
      for (const m of data ?? []) {
        bulunan.set(m.id as string, m as { id: string; user1_id: string; user2_id: string });
      }
    }
  }
  return [...bulunan.values()];
}

/** Aktif eslesmelerde son silinmemis mesaji insan atmis olanlari kuyruga alir. Eklenen satir sayisini doner. */
export async function scanAndEnqueue(now: Date = new Date()): Promise<number> {
  const { data: seedler } = await supabase
    .from('users')
    .select('id, seed_persona')
    .eq('is_seed_profile', true);
  if (!seedler?.length) return 0;

  const seedIds = seedler.map((u) => u.id as string);
  const seedIdSet = new Set(seedIds);
  const personaOf = new Map(
    seedler.map((u) => [u.id as string, (u.seed_persona as SeedPersona | null) ?? VARSAYILAN_PERSONA]),
  );

  const eslesmeler = await seedEslesmeleri(seedIds);
  if (!eslesmeler.length) return 0;

  const { data: acikSatirlar } = await supabase
    .from('seed_reply_queue')
    .select('match_id')
    .in('status', ['pending', 'claimed']);
  const acik = new Set((acikSatirlar ?? []).map((r) => r.match_id as string));

  const fastMode = await fastModeAcik();
  let eklenen = 0;

  for (const m of eslesmeler) {
    if (acik.has(m.id as string)) continue;
    const user1 = m.user1_id as string;
    const user2 = m.user2_id as string;
    const seedId = seedIdSet.has(user1) ? user1 : seedIdSet.has(user2) ? user2 : null;
    if (!seedId) continue;

    // Son SILINMEMIS mesaj: silinmis mesaja cevap yazmak hem urkutucu hem "silinen icerik okundu" sinyali.
    const { data: sonMesajlar } = await supabase
      .from('messages')
      .select('id, sender_id, content, created_at')
      .eq('match_id', m.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1);
    const son = sonMesajlar?.[0];
    if (!son || son.sender_id === seedId) continue;
    if (typeof son.content === 'string' && son.content.startsWith('__QUESTION__')) continue;

    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact' })
      .eq('match_id', m.id)
      .is('deleted_at', null);

    const gecikme = computeReplyDelayMs({
      persona: personaOf.get(seedId)!,
      now, fastMode, phase: fazFor(count ?? 0),
      messageCount: count ?? 0, msSinceLastExchange: null, rand: Math.random,
    });

    const { error } = await supabase.from('seed_reply_queue').insert({
      match_id: m.id, seed_user_id: seedId, trigger_message_id: son.id,
      kind: 'message', status: 'pending',
      reply_due_at: new Date(now.getTime() + gecikme).toISOString(),
    });
    // UNIQUE ihlali (yaris) normaldir: baska instance ayni satiri acmistir.
    if (!error) eklenen += 1;
  }
  return eklenen;
}

export async function claimDue(limit: number): Promise<QueueRow[]> {
  const { data, error } = await supabase.rpc('claim_seed_replies', { p_limit: limit });
  if (error) {
    console.error('[SeedReply] claim hatasi:', error.message);
    return [];
  }
  return (data ?? []) as QueueRow[];
}

async function durumYaz(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from('seed_reply_queue')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) console.error('[SeedReply] durum yazilamadi:', error.message);
}

export const markSent = (id: string) => durumYaz(id, { status: 'sent' });
export const markFailed = (id: string, error: string) => durumYaz(id, { status: 'failed', last_error: error.slice(0, 500) });
export const markCancelled = (id: string, reason: string) => durumYaz(id, { status: 'cancelled', last_error: reason.slice(0, 500) });
export const deferRow = (id: string, ms: number) =>
  durumYaz(id, { status: 'pending', reply_due_at: new Date(Date.now() + ms).toISOString() });

/** Coken instance'in biraktigi satirlari kurtarir. */
export async function recoverStale(olderThanMs = 5 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const { data } = await supabase
    .from('seed_reply_queue')
    .update({ status: 'pending', updated_at: new Date().toISOString() })
    .eq('status', 'claimed')
    .lt('claimed_at', cutoff)
    .select('id');
  return data?.length ?? 0;
}

// --- processRow: orkestrasyon (Task 7) -------------------------------------

const KRIZ = /(yaşamak istemiyorum|intihar|kendime zarar|canıma kıy|ölmek istiyorum|yaşamaktan bıktım)/i;
const YAS_ALTI = /\b(1[0-7])\s*yaş(ında|ındayım)?\b/i;
const KRIZ_CEVABI =
  'ya böyle yazınca içim cız etti. ciddiyim, bunu tek başına taşıma — 112\'yi arayabilirsin ya da yakınındaki birine söyle. ben buradayım ama bu konuda gerçekten yardım alman lazım.';

const GECMIS_LIMIT = 20;

function hataKodu(err: unknown): string {
  return String((err as { code?: string })?.code ?? (err as Error)?.message ?? '');
}

/**
 * Kuyruktan alinan bir satiri isler: persona karti kurar, LLM'den cevap uretir,
 * denetimden gecirir ve mevcut sohbet servisiyle gonderir.
 *
 * Kimlik cift kontrolu — tarama sorgusundaki WHERE tek savunma hatti sayilmaz;
 * bu feature'in en yuksek sonuclu hata modu botun gercek bir kullanici hesabindan
 * yazmasidir, bu yuzden gonderimden ONCE burada tekrar dogrulanir.
 */
export async function processRow(row: QueueRow): Promise<'sent' | 'deferred' | 'cancelled' | 'failed'> {
  const { data: seed } = await supabase
    .from('users')
    .select('id, name, age, city, bio, interests, relationship_goal, is_seed_profile, seed_persona')
    .eq('id', row.seed_user_id)
    .maybeSingle();
  if (!seed?.is_seed_profile) {
    await markCancelled(row.id, 'alici seed profil degil');
    return 'cancelled';
  }

  const { data: son } = await supabase
    .from('messages')
    .select('id, sender_id, content, created_at')
    .eq('match_id', row.match_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(GECMIS_LIMIT);
  const gecmis = (son ?? []).slice().reverse();
  const sonInsan = [...gecmis].reverse().find((m) => m.sender_id !== row.seed_user_id);
  const sonMetin = String(sonInsan?.content ?? '');

  if (YAS_ALTI.test(sonMetin)) {
    await markCancelled(row.id, '18 yas alti beyani');
    return 'cancelled';
  }

  let metin: string | null = null;

  if (KRIZ.test(sonMetin)) {
    metin = KRIZ_CEVABI; // Rolu birak; bu cevap LLM'den GECMEZ.
  } else {
    const { data: detay } = await supabase
      .from('user_details').select('job, personality, pets, music_type, smoking, alcohol')
      .eq('user_id', row.seed_user_id).maybeSingle();

    const persona = (seed.seed_persona as SeedPersona | null) ?? VARSAYILAN_PERSONA;
    const sistem = buildPersonaCard({
      name: String(seed.name ?? ''), age: Number(seed.age ?? 30),
      district: (seed.city as string) ?? null, province: null,
      bio: (seed.bio as string) ?? null, job: (detay?.job as string) ?? null,
      personality: (detay?.personality as string) ?? null, pets: (detay?.pets as string) ?? null,
      musicType: (detay?.music_type as string) ?? null, smoking: (detay?.smoking as string) ?? null,
      alcohol: (detay?.alcohol as string) ?? null, relationshipGoal: (seed.relationship_goal as string) ?? null,
      persona, phase: fazFor(gecmis.length), busyNow: isBusy(persona, new Date()),
    });

    const turns = gecmis.map((m) => ({
      role: (m.sender_id === row.seed_user_id ? 'model' : 'user') as 'model' | 'user',
      text: String(m.content ?? ''),
    }));

    for (let deneme = 0; deneme < 2 && metin === null; deneme += 1) {
      const sistemProbe = deneme === 0
        ? sistem
        : `${sistem}\n\n# UYARI\nBir onceki cevabin kurallari cignedi. Cok kisa yaz, iletisim bilgisi verme, liste yapma.`;
      let ham: string;
      try {
        ham = (await generateSeedReply({ system: sistemProbe, turns })).text;
      } catch (err) {
        await markFailed(row.id, `llm: ${hataKodu(err)}`);
        return 'failed';
      }
      const denetim = validateReply(ham, sistem);
      if (denetim.ok) metin = denetim.text;
      else console.warn(`[SeedReply] cikti elendi (${denetim.reason}) match=${row.match_id} deneme=${deneme + 1}`);
    }

    if (metin === null) {
      // Sessizlik, hazir kalip cevaptan daha gercekcidir (kalip tekrari en buyuk ele verme kaynagi).
      await markFailed(row.id, 'cikti denetimi iki denemede de gecilemedi');
      return 'failed';
    }
  }

  try {
    await chatService.sendMessage(row.seed_user_id, row.match_id, metin);
  } catch (err) {
    const kod = hataKodu(err);
    if (kod.includes('CHAT_LOCKED')) {
      await deferRow(row.id, 2 * 60_000);
      return 'deferred';
    }
    if (kod.includes('NOT_MATCHED') || kod.includes('MATCH_INACTIVE') || kod.includes('USER_BLOCKED')) {
      await markCancelled(row.id, kod);
      return 'cancelled';
    }
    await markFailed(row.id, kod);
    return 'failed';
  }

  // "3 gun once goruldu" yazarken canli cevap yazma tutarsizligini kapat.
  await supabase.from('users').update({ last_seen_at: new Date().toISOString() }).eq('id', row.seed_user_id);
  await markSent(row.id);
  return 'sent';
}
