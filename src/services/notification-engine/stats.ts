import { supabase } from '../../config/supabase.js';
import { LIFECYCLE_RULE_KEYS } from './rules.js';
import type { DecisionKind } from './engine.js';

/** Backoffice gorunurlugu: kural bazli sayimlar, son kosumlar, son kayitlar. */
export interface RuleStat {
  ruleKey: string;
  sent: number;
  dry_run: number;
  suppressed: number;
  holdout: number;
  failed: number;
  /** Gonderilenlerden inbox'ta okunan (tap → markAsRead) — Faz 1 acilis vekili. */
  opened: number;
}

export interface RunSummary {
  runId: string;
  mode: string;
  startedAt: string;
  counts: Record<DecisionKind, number>;
}

export interface RecentLogRow {
  id: number;
  createdAt: string;
  userId: string;
  userName: string;
  ruleKey: string;
  decision: string;
  reason: string | null;
  locale: string | null;
  mode: string;
  title: string | null;
  body: string | null;
  opened: boolean | null;
}

export interface EngineStats {
  tableMissing: boolean;
  byRule: RuleStat[];
  runs: RunSummary[];
  recent: RecentLogRow[];
}

interface LogRow {
  id: number;
  run_id: string;
  mode: string;
  user_id: string;
  rule_key: string;
  decision: DecisionKind;
  reason: string | null;
  locale: string | null;
  payload: { title?: string | null; body?: string | null } | null;
  notification_id: string | null;
  created_at: string;
}

const IN_CHUNK = 200;
const PAGE = 1000;
const MAX_ROWS = 5000;

function emptyCounts(): Record<DecisionKind, number> {
  return { sent: 0, dry_run: 0, suppressed: 0, holdout: 0, failed: 0 };
}

async function fetchInChunks<T>(table: string, columns: string, ids: string[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await supabase.from(table).select(columns).in('id', ids.slice(i, i + IN_CHUNK));
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

export async function getEngineStats(opts: { days?: number; recentLimit?: number; runsLimit?: number } = {}): Promise<EngineStats> {
  const days = opts.days ?? 7;
  const recentLimit = opts.recentLimit ?? 100;
  const runsLimit = opts.runsLimit ?? 20;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // PostgREST max-rows (1000) nedeniyle sayfali; en fazla MAX_ROWS satir (7 gunluk istatistik icin yeterli)
  const rows: LogRow[] = [];
  let error: { message: string } | null = null;
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const res = await supabase
      .from('push_log')
      .select('id, run_id, mode, user_id, rule_key, decision, reason, locale, payload, notification_id, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .range(from, Math.min(from + PAGE, MAX_ROWS) - 1);
    if (res.error) { error = res.error; break; }
    const page = (res.data ?? []) as LogRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const byRuleMap = new Map<string, RuleStat>(
    LIFECYCLE_RULE_KEYS.map((k) => [k, { ruleKey: k, sent: 0, dry_run: 0, suppressed: 0, holdout: 0, failed: 0, opened: 0 }]),
  );
  if (error) {
    return { tableMissing: true, byRule: [...byRuleMap.values()], runs: [], recent: [] };
  }

  const notificationIds = rows.map((r) => r.notification_id).filter((id): id is string => !!id);
  const openedById = new Map<string, boolean>();
  for (const n of await fetchInChunks<{ id: string; is_read: boolean }>('notifications', 'id, is_read', notificationIds)) {
    openedById.set(n.id, !!n.is_read);
  }

  const runsMap = new Map<string, RunSummary>();
  for (const r of rows) {
    const stat = byRuleMap.get(r.rule_key) ?? { ruleKey: r.rule_key, sent: 0, dry_run: 0, suppressed: 0, holdout: 0, failed: 0, opened: 0 };
    byRuleMap.set(r.rule_key, stat);
    stat[r.decision] = (stat[r.decision] ?? 0) + 1;
    if (r.decision === 'sent' && r.notification_id && openedById.get(r.notification_id)) stat.opened++;

    const run = runsMap.get(r.run_id) ?? { runId: r.run_id, mode: r.mode, startedAt: r.created_at, counts: emptyCounts() };
    runsMap.set(r.run_id, run);
    run.counts[r.decision]++;
    if (r.created_at < run.startedAt) run.startedAt = r.created_at;
  }

  const recentRows = rows.slice(0, recentLimit);
  const userIds = [...new Set(recentRows.map((r) => r.user_id))];
  const nameById = new Map<string, string>();
  for (const u of await fetchInChunks<{ id: string; name: string | null }>('users', 'id, name', userIds)) {
    nameById.set(u.id, u.name ?? '');
  }

  const recent: RecentLogRow[] = recentRows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    userId: r.user_id,
    userName: nameById.get(r.user_id) ?? '',
    ruleKey: r.rule_key,
    decision: r.decision,
    reason: r.reason,
    locale: r.locale,
    mode: r.mode,
    title: r.payload?.title ?? null,
    body: r.payload?.body ?? null,
    opened: r.notification_id ? (openedById.get(r.notification_id) ?? false) : null,
  }));

  return {
    tableMissing: false,
    byRule: [...byRuleMap.values()],
    runs: [...runsMap.values()].slice(0, runsLimit),
    recent,
  };
}
