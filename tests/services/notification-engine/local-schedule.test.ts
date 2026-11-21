import { describe, it, expect, vi } from 'vitest';
import { createFakeSupabase } from '../../helpers/fake-supabase.js';
import type { Row, Tables } from '../../helpers/fake-supabase.js';
import { suppressedByLocalSchedule, LOCAL_TO_SERVER_RULES } from '../../../src/services/notification-engine/local-schedule.js';
import { LOCAL_SCHEDULE_RULES } from '../../../src/validators/local-schedule.validator.js';
import { LIFECYCLE_RULE_KEYS } from '../../../src/services/notification-engine/rules.js';
import { holdoutBucket } from '../../../src/services/notification-engine/throttle.js';

/** NOW = 16:00 UTC → 'tr' (lng 29) yerel 19:00 = varsayilan gonderim saati. */
const NOW = new Date('2026-09-07T16:00:00.000Z');
const D = 24 * 3600 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const ahead = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

function user(o: Row & { id: string }): Row {
  return {
    name: `N-${o.id}`, locale: 'tr', lng: 29, push_token: `tok-${o.id}`,
    last_active_at: ago(5 * D), last_seen_at: null, created_at: ago(60 * D),
    question_count: 2, photos: ['p.jpg'], notification_preferences: null,
    is_deleted: false, is_banned: false, is_test_account: false, is_seed_profile: false, local_schedule: null,
    ...o,
  };
}

/** U: 5 gun inaktif → new_people uygun (yeterli yeni kullanici var) + yarim quiz → quiz_unfinished uygun. */
function seed(localSchedule: unknown, holdoutFriendly = true): Tables {
  const newcomers = [1, 2, 3].map((i) => user({ id: `new${i}`, locale: 'en', lng: 0, created_at: ago(i * D), last_active_at: ago(1000) }));
  return {
    notification_engine_config: [{ id: 1, config: { dry_run: true, holdout_pct: holdoutFriendly ? 0 : 50 } }],
    users: [user({ id: 'U', local_schedule: localSchedule }), ...newcomers],
    matches: [], messages: [], swipes: [], push_log: [], notifications: [], push_messages: [],
    quiz_sessions: [{ id: 'q1', solver_id: 'U', target_id: 'new1', status: 'IN_PROGRESS', started_at: ago(3 * D), expires_at: ago(2 * D) }],
  };
}

async function runFor(tables: Tables) {
  vi.resetModules();
  const fake = createFakeSupabase(tables);
  vi.doMock('../../../src/config/supabase.js', () => ({ supabase: fake.client, ensureStorageBuckets: async () => {} }));
  vi.doMock('../../../src/config/firebase.js', () => ({ getFcm: () => ({ send: vi.fn() }), isFcmAvailable: () => true, firebaseAdmin: {} }));
  const { runEngine } = await import('../../../src/services/notification-engine/engine.js');
  const r = await runEngine('simulate', { now: NOW });
  return { fake, ruleOfU: r.decisions.find((d) => d.userId === 'U')?.ruleKey ?? null };
}

describe('suppressedByLocalSchedule', () => {
  it('suresi gecmemis plan: eslenen sunucu kurallari doner', () => {
    const s = suppressedByLocalSchedule({ rules: ['quiz_unfinished', 'return_3d'], until: ahead(D) }, NOW.getTime());
    expect([...s].sort()).toEqual(['lifecycle_new_people', 'lifecycle_quiz_unfinished']);
  });

  it('until gecmis veya sinirda → bos', () => {
    expect(suppressedByLocalSchedule({ rules: ['new_people'], until: ago(1000) }, NOW.getTime()).size).toBe(0);
    expect(suppressedByLocalSchedule({ rules: ['new_people'], until: NOW.toISOString() }, NOW.getTime()).size).toBe(0);
  });

  it('bozuk jsonb (null, dizi degil, tarih bozuk, bilinmeyen kural) → bos, patlamaz', () => {
    for (const raw of [null, undefined, 'x', 5, {}, { rules: 'a', until: ahead(D) }, { rules: ['new_people'], until: 'yarin' }, { rules: ['evil'], until: ahead(D) }]) {
      expect(suppressedByLocalSchedule(raw, NOW.getTime()).size).toBe(0);
    }
  });

  it('etkilenmeyen kurallar hicbir yerel kuralin eslemesinde yok', () => {
    const hedef = new Set(Object.values(LOCAL_TO_SERVER_RULES).flat());
    for (const k of ['lifecycle_unread_message', 'lifecycle_match_waiting', 'lifecycle_likes_waiting', 'lifecycle_profile_incomplete', 'lifecycle_day1_return', 'lifecycle_winback']) {
      expect(hedef.has(k as never)).toBe(false);
    }
  });

  it('esleme tablosu her bilinen yerel kurali kapsar ve yalniz gecerli sunucu anahtarlarina isaret eder', () => {
    expect(Object.keys(LOCAL_TO_SERVER_RULES).sort()).toEqual([...LOCAL_SCHEDULE_RULES].sort());
    for (const keys of Object.values(LOCAL_TO_SERVER_RULES)) for (const k of keys) expect(LIFECYCLE_RULE_KEYS).toContain(k);
  });
});

describe('motor — yerel plan (uctan uca, simulate)', () => {
  it('plan yokken: oncelik sirasinda ilk uyan kural (quiz_unfinished) secilir', async () => {
    expect((await runFor(seed(null))).ruleOfU).toBe('lifecycle_quiz_unfinished');
  });

  it('quiz_unfinished planli → quiz atlanir, siradaki uyan kural (new_people) secilir', async () => {
    expect((await runFor(seed({ rules: ['quiz_unfinished'], until: ahead(D) }))).ruleOfU).toBe('lifecycle_new_people');
  });

  it('quiz + return_3d planli → ikisi de atlanir, uyan baska kural yok', async () => {
    expect((await runFor(seed({ rules: ['quiz_unfinished', 'return_3d'], until: ahead(D) }))).ruleOfU).toBeNull();
  });

  it('until gecmisse plan yok sayilir (kural atlanmaz)', async () => {
    expect((await runFor(seed({ rules: ['quiz_unfinished'], until: ago(60_000) }))).ruleOfU).toBe('lifecycle_quiz_unfinished');
  });

  it('ilgisiz yerel kural (limit_refreshed) hicbir seyi etkilemez', async () => {
    expect((await runFor(seed({ rules: ['limit_refreshed'], until: ahead(D) }))).ruleOfU).toBe('lifecycle_quiz_unfinished');
  });

  it('ilgisiz sunucu kurallari etkilenmez: planli kullanicida match_waiting yine secilir', async () => {
    const t = seed({ rules: ['quiz_unfinished', 'new_people', 'return_3d', 'return_7d'], until: ahead(D) });
    t.matches = [{ id: 'm1', user1_id: 'U', user2_id: 'new1', matched_at: ago(3 * D), is_active: true }];
    expect((await runFor(t)).ruleOfU).toBe('lifecycle_match_waiting');
  });

  it('holdout davranisi degismez: holdout kovasindaki kullanici plan olsa da olmasa da holdout (plan holdout\'u atlatmaz)', async () => {
    let id = 'h0';
    for (let i = 0; holdoutBucket(id) >= 50; i++) id = `h${i}`; // %50 holdout'a dusen deterministik id
    for (const plan of [null, { rules: ['quiz_unfinished'], until: ahead(D) }]) {
      const t = seed(plan, false);
      for (const u of t.users!) if (u.id === 'U') u.id = id;
      for (const q of t.quiz_sessions!) q.solver_id = id;
      vi.resetModules();
      const fake = createFakeSupabase(t);
      vi.doMock('../../../src/config/supabase.js', () => ({ supabase: fake.client, ensureStorageBuckets: async () => {} }));
      vi.doMock('../../../src/config/firebase.js', () => ({ getFcm: () => ({ send: vi.fn() }), isFcmAvailable: () => true, firebaseAdmin: {} }));
      const { runEngine } = await import('../../../src/services/notification-engine/engine.js');
      const r = await runEngine('simulate', { now: NOW });
      expect(r.decisions.find((x) => x.userId === id)?.decision).toBe('holdout');
    }
  });

  it('ek DB sorgusu yok: plan yokken ve varken ayni tablolar ayni sayida okunur (users tek sorgu)', async () => {
    const a = await runFor(seed(null));
    const b = await runFor(seed({ rules: ['quiz_unfinished'], until: ahead(D) }));
    const sayim = (f: typeof a.fake) => {
      const m: Record<string, number> = {};
      for (const q of f.queries) m[`${q.table}:${q.op}`] = (m[`${q.table}:${q.op}`] ?? 0) + 1;
      return m;
    };
    expect(sayim(b.fake)).toEqual(sayim(a.fake));
    expect(sayim(b.fake)['users:select']).toBe(1);
  });
});
