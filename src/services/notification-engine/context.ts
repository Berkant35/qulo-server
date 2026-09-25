import { supabase } from '../../config/supabase.js';
import { DAY_MS } from './timezone.js';

export { DAY_MS };

/**
 * Motorun bir turda ihtiyac duydugu verinin bellek ici goruntusu.
 * Kurallar (rules.ts) DB'ye dokunmaz; sadece bu baglami okur — saf ve test edilebilir kalirlar.
 * Olcek notu: ~10k kullaniciya kadar tek tur icin yeterli; sonrasi Faz 2 (sadece 'sent' satirlari).
 */
export interface EngineUser {
  id: string;
  name: string | null;
  locale: string | null;
  lng: number | null;
  push_token: string | null;
  /** Uygulama resume'da guncellenir (5 dk debounce). */
  last_active_at: string | null;
  /** Presence heartbeat (60 sn, on planda). Aktiflik icin ikisinin buyugu kullanilir (rules.lastActiveMs). */
  last_seen_at: string | null;
  created_at: string;
  question_count: number | null;
  photos: string[] | null;
  email_verified: boolean | null;
  notification_preferences: Record<string, boolean> | null;
  is_deleted: boolean | null;
  is_banned: boolean | null;
  is_test_account: boolean | null;
  is_seed_profile: boolean | null;
}

export interface EngineMatch {
  id: string;
  user1_id: string;
  user2_id: string;
  matched_at: string;
}

export interface EngineMessage {
  id: string;
  match_id: string;
  sender_id: string;
  read_at: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface EngineQuizSession {
  id: string;
  solver_id: string;
  target_id: string;
  started_at: string | null;
  expires_at: string | null;
}

export interface EngineLike {
  swiper_id: string;
  target_id: string;
  created_at: string;
}

export interface PushLogEntry {
  id: number;
  ruleKey: string;
  decision: string;
  createdAt: number;
}

export interface EngineContext {
  now: Date;
  /** Silinmis/banli/test/seed elenmis, push token'i olan kullanicilar. */
  users: EngineUser[];
  /** Elenmemis (silinmemis) tum kullanicilar — karsi taraf isimleri icin. */
  usersById: Map<string, EngineUser>;
  matchesByUser: Map<string, EngineMatch[]>;
  messagesByMatch: Map<string, EngineMessage[]>;
  expiredQuizBySolver: Map<string, EngineQuizSession[]>;
  likesByTarget: Map<string, EngineLike[]>;
  /** Son 7 gunde katilan, kesfette gorunur (dogrulanmis + 2 soru + 1 foto) kullanici sayisi. */
  newVisibleUsers7d: number;
  /** push_log: son 20 saatteki TUM kararlar + lookback penceresindeki 'sent' satirlari (id ile tekillestirilmis). */
  logByUser: Map<string, PushLogEntry[]>;
  /** Gercek gonderim zamanlari (lifecycle 'sent' + kampanya) — tavan/holdout icin throttle.ts'e verilir. */
  sendTimes: Map<string, number[]>;
}

const USER_COLUMNS =
  'id, name, locale, lng, push_token, last_active_at, last_seen_at, created_at, question_count, photos, email_verified, ' +
  'notification_preferences, is_deleted, is_banned, is_test_account, is_seed_profile';
/** Supabase/PostgREST varsayilan max-rows = 1000: sayfalanmayan sorgu sessizce kirpilir. Her liste sorgusu fetchAll'dan gecer. */
const PAGE_SIZE = 1000;
/** "Gunde tek karar" penceresi (engine.ts DECISION_WINDOW_MS ile ayni). */
export const DECISION_WINDOW_MS = 20 * 60 * 60 * 1000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

type PageResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Sirali (order zorunlu) range sayfalamasiyla tum satirlari ceker. Liste sorgusu yazan HER servis bunu kullanir. */
export async function fetchAll<T>(page: (from: number, to: number) => PageResult): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) return all;
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function loadAllUsers(): Promise<EngineUser[]> {
  return fetchAll<EngineUser>((from, to) =>
    supabase.from('users').select(USER_COLUMNS).eq('is_deleted', false).order('created_at', { ascending: true }).range(from, to),
  );
}

/** Push'a uygunluk icin gereken alanlar — motor (EngineUser) ve kampanya hedefi ayni kurali paylasir. */
export type EligibilityFields = Pick<EngineUser, 'is_deleted' | 'is_banned' | 'is_test_account' | 'is_seed_profile' | 'push_token'>;

export function isEligibleUser(u: EligibilityFields): boolean {
  return (
    !u.is_deleted &&
    !u.is_banned &&
    !u.is_test_account &&
    !u.is_seed_profile &&
    typeof u.push_token === 'string' &&
    u.push_token.length > 0
  );
}

export function isVisibleProfile(u: EngineUser): boolean {
  return !!u.email_verified && (u.question_count ?? 0) >= 2 && (u.photos?.length ?? 0) >= 1;
}

interface PushLogRow {
  id: number;
  user_id: string;
  rule_key: string;
  decision: string;
  created_at: string;
}

export interface CampaignSendRow {
  user_id: string;
  created_at: string;
}

export interface SendHistory {
  /** push_log 'sent' satirlari (lookback kadar geriye). */
  sentLog: PushLogRow[];
  /** notifications.type='campaign' satirlari (son 7 gun) — admin/tekrarlayan kampanya gonderimleri. */
  campaignSends: CampaignSendRow[];
}

/**
 * Gercek gonderim gecmisi — gunluk/haftalik tavan icin tek kaynak. Motor da tekrarlayan kampanya
 * gondericisi de buradan okur; boylece ikisi birbirinin gonderimini tavana sayar.
 */
export async function loadSendHistory(nowMs: number, lookbackDays: number): Promise<SendHistory> {
  const PUSH_LOG_COLUMNS = 'id, user_id, rule_key, decision, created_at';
  const sinceLookback = iso(nowMs - Math.max(7, lookbackDays) * DAY_MS);
  const since7d = iso(nowMs - 7 * DAY_MS);
  const [sentLog, campaignSends] = await Promise.all([
    fetchAll<PushLogRow>((from, to) =>
      supabase.from('push_log').select(PUSH_LOG_COLUMNS).eq('decision', 'sent').gte('created_at', sinceLookback).order('id').range(from, to),
    ),
    fetchAll<CampaignSendRow>((from, to) =>
      supabase.from('notifications').select('user_id, created_at').eq('type', 'campaign').gte('created_at', since7d).order('created_at').range(from, to),
    ),
  ]);
  return { sentLog, campaignSends };
}

/** Kullanici basina gercek gonderim zamanlari (lifecycle 'sent' + kampanya) — tavan sayimi icin. */
export function sendTimesByUser(history: SendHistory): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const row of history.sentLog) push(map, row.user_id, Date.parse(row.created_at));
  for (const row of history.campaignSends) push(map, row.user_id, Date.parse(row.created_at));
  return map;
}

export interface LoadContextOptions {
  /** 'sent' satirlarinin ne kadar geriye yuklenecegi — en buyuk kural cooldown'u (min 7 gun, haftalik tavan icin). */
  logLookbackDays?: number;
}

export async function loadContext(now: Date = new Date(), opts: LoadContextOptions = {}): Promise<EngineContext> {
  const nowMs = now.getTime();
  const lookbackDays = Math.max(7, opts.logLookbackDays ?? 30);
  const since30d = iso(nowMs - 30 * DAY_MS);
  const since14d = iso(nowMs - 14 * DAY_MS);
  const sinceDecisionWindow = iso(nowMs - DECISION_WINDOW_MS);
  const PUSH_LOG_COLUMNS = 'id, user_id, rule_key, decision, created_at';

  const allUsers = await loadAllUsers();
  const usersById = new Map(allUsers.map((u) => [u.id, u]));
  const users = allUsers.filter(isEligibleUser);

  const [matches, messages, quizSessions, likes, history, recentLog] = await Promise.all([
    fetchAll<EngineMatch>((from, to) =>
      supabase.from('matches').select('id, user1_id, user2_id, matched_at').eq('is_active', true).gte('matched_at', since30d).order('matched_at').range(from, to),
    ),
    fetchAll<EngineMessage>((from, to) =>
      supabase.from('messages').select('id, match_id, sender_id, read_at, created_at, deleted_at').gte('created_at', since30d).order('created_at').range(from, to),
    ),
    fetchAll<EngineQuizSession>((from, to) =>
      supabase
        .from('quiz_sessions')
        .select('id, solver_id, target_id, started_at, expires_at')
        .eq('status', 'IN_PROGRESS')
        .lt('expires_at', now.toISOString())
        .gte('started_at', since14d)
        .order('started_at')
        .range(from, to),
    ),
    fetchAll<EngineLike>((from, to) =>
      supabase.from('swipes').select('swiper_id, target_id, created_at').eq('action', 'LIKE').gte('created_at', since30d).order('created_at').range(from, to),
    ),
    // Tavan + cooldown icin: sadece gercek gonderimler (lifecycle + kampanya), lookback kadar geriye
    loadSendHistory(nowMs, lookbackDays),
    // "Gunde tek karar" icin: son 20 saatteki her karar
    fetchAll<PushLogRow>((from, to) =>
      supabase.from('push_log').select(PUSH_LOG_COLUMNS).gte('created_at', sinceDecisionWindow).order('id').range(from, to),
    ),
  ]);
  const { sentLog } = history;

  const matchesByUser = new Map<string, EngineMatch[]>();
  const activeMatchIds = new Set<string>();
  for (const m of matches) {
    activeMatchIds.add(m.id);
    push(matchesByUser, m.user1_id, m);
    push(matchesByUser, m.user2_id, m);
  }

  const messagesByMatch = new Map<string, EngineMessage[]>();
  for (const msg of messages) {
    if (msg.deleted_at || !activeMatchIds.has(msg.match_id)) continue;
    push(messagesByMatch, msg.match_id, msg);
  }

  const expiredQuizBySolver = new Map<string, EngineQuizSession[]>();
  for (const q of quizSessions) push(expiredQuizBySolver, q.solver_id, q);

  const likesByTarget = new Map<string, EngineLike[]>();
  for (const like of likes) push(likesByTarget, like.target_id, like);

  const logByUser = new Map<string, PushLogEntry[]>();
  const seenLogIds = new Set<number>();
  for (const row of [...sentLog, ...recentLog]) {
    if (seenLogIds.has(row.id)) continue; // son 20 saatteki 'sent' satiri iki sorguda da gelir
    seenLogIds.add(row.id);
    push(logByUser, row.user_id, { id: row.id, ruleKey: row.rule_key, decision: row.decision, createdAt: Date.parse(row.created_at) });
  }

  const sendTimes = sendTimesByUser(history);

  const newVisibleUsers7d = allUsers.filter(
    (u) => Date.parse(u.created_at) >= nowMs - 7 * DAY_MS && !u.is_test_account && !u.is_seed_profile && !u.is_banned && isVisibleProfile(u),
  ).length;

  return {
    now,
    users,
    usersById,
    matchesByUser,
    messagesByMatch,
    expiredQuizBySolver,
    likesByTarget,
    newVisibleUsers7d,
    logByUser,
    sendTimes,
  };
}
