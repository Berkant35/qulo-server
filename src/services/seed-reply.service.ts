import { supabase } from '../config/supabase.js';
import { computeReplyDelayMs } from './seed-reply-timing.js';
import type { SeedPersona } from '../types/seed-persona.js';

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

  // fake-supabase'in `.or()` yardimcisi yalnizca `eq` karsilastirmalarini destekliyor
  // (bkz. tests/helpers/fake-supabase.ts) — prod'daki gercek kod tabaninin her yerdeki
  // deseniyle ayni (account-purge/chat/matching servisleri de `eq` ile or() kurar).
  // Eslesme sayisi seed hesaplariyla sinirli (N kucuk) oldugu icin bu N-parca or()
  // sorgusu buyumez.
  const orExpression = seedIds.map((id) => `user1_id.eq.${id},user2_id.eq.${id}`).join(',');
  const { data: eslesmeler } = await supabase
    .from('matches')
    .select('id, user1_id, user2_id')
    .eq('is_active', true)
    .or(orExpression);
  if (!eslesmeler?.length) return 0;

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
