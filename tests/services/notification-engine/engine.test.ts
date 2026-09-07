import { describe, it, expect, vi } from 'vitest';
import { createFakeSupabase } from '../../helpers/fake-supabase.js';
import type { Tables, FailureSpec, Row } from '../../helpers/fake-supabase.js';

/**
 * Motorun ucdan uca davranisi — gercek servisler (engine → context → notification.service),
 * sadece DB (fake-supabase) ve FCM (send spy) taklit.
 * NOW = 16:00 UTC → locale 'tr' icin yerel 19:00 = varsayilan gonderim saati.
 */
const NOW = new Date('2026-09-07T16:00:00.000Z');
const H = 3600 * 1000;
const D = 24 * H;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function user(overrides: Row & { id: string }): Row {
  return {
    name: `Name-${overrides.id}`,
    locale: 'tr',
    lng: 29,
    push_token: `tok-${overrides.id}`,
    last_active_at: ago(5 * D),
    last_seen_at: null,
    created_at: ago(60 * D),
    question_count: 2,
    photos: ['p.jpg'],
    email_verified: true,
    notification_preferences: null,
    is_deleted: false,
    is_banned: false,
    is_test_account: false,
    is_seed_profile: false,
    ...overrides,
  };
}

/** A: tr, pencere icinde, B ile eslesmis ve hic yazmamis. B: en + lng 0 → yerel 16, pencere disinda. */
function seed(config: Row = {}, extra: Partial<Tables> = {}): Tables {
  return {
    notification_engine_config: [{ id: 1, config }],
    users: [user({ id: 'A' }), user({ id: 'B', name: 'Bora', locale: 'en', lng: 0 })],
    matches: [{ id: 'm1', user1_id: 'A', user2_id: 'B', matched_at: ago(3 * D), is_active: true }],
    messages: [],
    quiz_sessions: [],
    swipes: [],
    push_log: [],
    notifications: [],
    push_messages: [],
    ...extra,
  };
}

async function boot(tables: Tables, opts: { failOn?: FailureSpec[]; send?: ReturnType<typeof vi.fn> } = {}) {
  vi.resetModules();
  const fake = createFakeSupabase(tables, { failOn: opts.failOn });
  const send = opts.send ?? vi.fn().mockResolvedValue('msg-1');
  vi.doMock('../../../src/config/supabase.js', () => ({ supabase: fake.client, ensureStorageBuckets: async () => {} }));
  vi.doMock('../../../src/config/firebase.js', () => ({ getFcm: () => ({ send }), isFcmAvailable: () => true, firebaseAdmin: {} }));
  const { runEngine } = await import('../../../src/services/notification-engine/engine.js');
  return { fake, send, runEngine };
}

let seededLogId = 100_000; // prod'da bigserial; fake seed'de id'siz satir olmasin (tekillestirme id ile)
const sentRow = (userId: string, ruleKey: string, at: string, decision = 'sent'): Row => ({
  id: ++seededLogId,
  run_id: 'old-run',
  mode: 'live',
  user_id: userId,
  rule_key: ruleKey,
  decision,
  reason: null,
  locale: 'tr',
  payload: null,
  notification_id: null,
  created_at: at,
});

describe('runEngine — kapali / tablo yok', () => {
  it('config.enabled=false → hicbir sey degerlendirilmez, kayit yazilmaz', async () => {
    const { fake, runEngine, send } = await boot(seed({ enabled: false }));
    const r = await runEngine('live', { now: NOW });
    expect(r.enabled).toBe(false);
    expect(r.evaluated).toBe(0);
    expect(fake.table('push_log')).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('config tablosu yoksa (42P01, migration uygulanmamis) motor kapali sayilir', async () => {
    const { runEngine } = await boot(seed(), {
      failOn: [{ table: 'notification_engine_config', op: 'select', error: { message: 'relation "notification_engine_config" does not exist', code: '42P01' } }],
    });
    const r = await runEngine('live', { now: NOW });
    expect(r.tableMissing).toBe(true);
    expect(r.enabled).toBe(false);
    expect(r.decisions).toHaveLength(0);
  });

  it('config gecici DB hatasiyla okunamazsa da motor o turda kapali (tableMissing degil)', async () => {
    const { fake, runEngine } = await boot(seed(), { failOn: [{ table: 'notification_engine_config', op: 'select', error: { message: 'connection reset', code: '08006' } }] });
    const r = await runEngine('live', { now: NOW });
    expect(r.tableMissing).toBe(false);
    expect(r.enabled).toBe(false);
    expect(r.evaluated).toBe(0);
    expect(fake.table('push_log')).toHaveLength(0);
  });
});

describe('runEngine — pencere, gunde tek karar, dry-run', () => {
  it('yerel saati gonderim saatine esit olmayan kullanici atlanir; digeri dry-run karari alir', async () => {
    const { fake, runEngine, send } = await boot(seed());
    const r = await runEngine('live', { now: NOW });
    expect(r.mode).toBe('dry_run');
    expect(r.outsideWindow).toBe(1);
    expect(r.decisions).toHaveLength(1);
    const d = r.decisions[0]!;
    expect(d.userId).toBe('A');
    expect(d.ruleKey).toBe('lifecycle_match_waiting');
    expect(d.decision).toBe('dry_run');
    expect(d.title).toBe('Eşleşmen seni bekliyor');
    expect(d.body).toContain('Bora ile eşleştin');
    expect(d.actionUrl).toBe('/chat/m1');

    const log = fake.table('push_log');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ user_id: 'A', rule_key: 'lifecycle_match_waiting', decision: 'dry_run', mode: 'dry_run', locale: 'tr' });
    expect(log[0]!.payload.title).toBe('Eşleşmen seni bekliyor');
    expect(fake.table('notifications')).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('ayni gun ikinci kosum ayni kullanici icin yeni karar uretmez', async () => {
    const { fake, runEngine } = await boot(seed());
    await runEngine('live', { now: NOW });
    const second = await runEngine('live', { now: new Date(NOW.getTime() + 15 * 60 * 1000) });
    expect(second.decidedToday).toBe(1);
    expect(second.decisions).toHaveLength(0);
    expect(fake.table('push_log')).toHaveLength(1);
  });
});

describe('runEngine — canli gonderim', () => {
  it('dry_run=false → FCM gider, inbox satiri yazilir, push_log sent + notification_id', async () => {
    const { fake, runEngine, send } = await boot(seed({ dry_run: false }));
    const r = await runEngine('live', { now: NOW });
    expect(r.mode).toBe('live');
    expect(send).toHaveBeenCalledTimes(1);
    const msg = send.mock.calls[0]![0];
    expect(msg.token).toBe('tok-A');
    expect(msg.data.type).toBe('lifecycle_match_waiting');
    expect(msg.data.action_url).toBe('/chat/m1');
    expect(msg.data.notification_id).toBeDefined();

    const inbox = fake.table('notifications');
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ user_id: 'A', type: 'lifecycle_match_waiting', action_url: '/chat/m1' });

    const log = fake.table('push_log');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ decision: 'sent', mode: 'live', notification_id: inbox[0]!.id });
  });

  it('push_log yazilamazsa gonderim YAPILMAZ (dayanikli kayit once, FCM sonra)', async () => {
    const { fake, runEngine, send } = await boot(seed({ dry_run: false }), { failOn: [{ table: 'push_log', op: 'insert' }] });
    const r = await runEngine('live', { now: NOW });
    expect(r.decisions[0]).toMatchObject({ userId: 'A', decision: 'suppressed', reason: 'log_write_failed' });
    expect(send).not.toHaveBeenCalled();
    expect(fake.table('notifications')).toHaveLength(0);
  });

  it('kayit gonderimden once in_flight atilir, gonderim sonrasi ayni satir sent olur (ikinci satir yok)', async () => {
    const { fake, runEngine } = await boot(seed({ dry_run: false }));
    await runEngine('live', { now: NOW });
    const log = fake.table('push_log');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ decision: 'sent', reason: null });
    expect(log[0]!.payload.title).toBe('Eşleşmen seni bekliyor');
  });

  it('FCM stale token hatasi → failed/fcm_error ve token temizlenir', async () => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error('bad token'), { errorInfo: { code: 'messaging/registration-token-not-registered' } }));
    const { fake, runEngine } = await boot(seed({ dry_run: false }), { send });
    const r = await runEngine('live', { now: NOW });
    expect(r.decisions[0]).toMatchObject({ decision: 'failed', reason: 'fcm_error' });
    expect(fake.table('users').find((u) => u.id === 'A')!.push_token).toBeNull();
    expect(fake.table('push_log')[0]).toMatchObject({ decision: 'failed', reason: 'fcm_error' });
  });

  it('max_per_run: tur limiti dolunca kalanlar run_cap ile bastirilir', async () => {
    const tables = seed({ dry_run: false, max_per_run: 1 });
    tables.users!.push(user({ id: 'D', created_at: ago(50 * D) }));
    tables.matches!.push({ id: 'm2', user1_id: 'D', user2_id: 'B', matched_at: ago(3 * D), is_active: true });
    const { fake, runEngine, send } = await boot(tables);
    const r = await runEngine('live', { now: NOW });
    expect(send).toHaveBeenCalledTimes(1);
    expect(r.decisions.map((d) => [d.userId, d.decision])).toEqual([['A', 'sent']]);
    expect(r.runCapped).toBe(1);
    // Tur limitine takilan icin kayit YOK → sonraki tikte tekrar degerlendirilir (ac kalmaz)
    expect(fake.table('push_log').map((row) => row.user_id)).toEqual(['A']);
    const next = await runEngine('live', { now: new Date(NOW.getTime() + 15 * 60 * 1000) });
    expect(next.decisions.map((d) => [d.userId, d.decision])).toEqual([['D', 'sent']]);
  });

  it('canli modda susturulmus sablon → template_muted; inbox satiri yazilmaz, FCM cagrilmaz', async () => {
    const { fake, runEngine, send } = await boot(
      seed({ dry_run: false }, { push_messages: [{ type: 'lifecycle_match_waiting', locale: 'tr', title: null, body: null, is_active: false }] }),
    );
    const r = await runEngine('live', { now: NOW });
    expect(r.decisions[0]).toMatchObject({ decision: 'suppressed', reason: 'template_muted' });
    expect(fake.table('notifications')).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('runEngine — tavanlar, cooldown, holdout, tercih', () => {
  it('gunluk tavan: bugun admin kampanyasi almis kullanici bastirilir (kampanyalar butceye dahil)', async () => {
    const { fake, runEngine } = await boot(
      seed({}, { notifications: [{ id: 'n0', user_id: 'A', type: 'campaign', created_at: ago(2 * H), is_read: false }] }),
    );
    const r = await runEngine('live', { now: NOW });
    expect(r.decisions[0]).toMatchObject({ userId: 'A', decision: 'suppressed', reason: 'daily_cap' });
    expect(fake.table('push_log')[0]).toMatchObject({ decision: 'suppressed', reason: 'daily_cap' });
  });

  it('haftalik tavan: son 7 gunde 3 gonderim varsa bastirilir', async () => {
    const { runEngine } = await boot(
      seed({}, {
        push_log: [
          sentRow('A', 'lifecycle_likes_waiting', ago(2 * D)),
          sentRow('A', 'lifecycle_quiz_unfinished', ago(3 * D)),
          sentRow('A', 'lifecycle_new_people', ago(4 * D)),
        ],
      }),
    );
    const r = await runEngine('live', { now: NOW });
    expect(r.decisions[0]).toMatchObject({ decision: 'suppressed', reason: 'weekly_cap' });
  });

  it('dry_run kayitlari tavana sayilmaz (sadece gercek gonderimler)', async () => {
    const { runEngine } = await boot(
      seed({}, { push_log: [sentRow('A', 'lifecycle_likes_waiting', ago(2 * D), 'dry_run'), sentRow('A', 'lifecycle_quiz_unfinished', ago(3 * D), 'dry_run'), sentRow('A', 'lifecycle_new_people', ago(4 * D), 'dry_run')] }),
    );
    const r = await runEngine('live', { now: NOW });
    expect(r.decisions[0]).toMatchObject({ decision: 'dry_run', ruleKey: 'lifecycle_match_waiting' });
  });

  it('cooldown: ayni kural yakin zamanda gittiyse oncelikte sonraki kurala gecilir', async () => {
    const tables = seed({}, { push_log: [sentRow('A', 'lifecycle_match_waiting', ago(2 * D))] });
    for (const id of ['N1', 'N2', 'N3']) tables.users!.push(user({ id, created_at: ago(2 * D), last_active_at: null }));
    const { runEngine } = await boot(tables);
    const r = await runEngine('live', { now: NOW });
    const a = r.decisions.find((d) => d.userId === 'A');
    expect(a).toMatchObject({ ruleKey: 'lifecycle_new_people', decision: 'dry_run' });
    expect(a!.body).toContain('3 yeni kişi');
    expect(r.decisions.filter((d) => d.userId !== 'A')).toHaveLength(0);
  });

  it('cooldown 30 gunden uzunsa da gorulur (lookback en uzun cooldown kadar)', async () => {
    const tables = seed({ rules: { lifecycle_match_waiting: { cooldown_days: 60 } } }, { push_log: [sentRow('A', 'lifecycle_match_waiting', ago(40 * D))] });
    const { runEngine } = await boot(tables);
    const r = await runEngine('live', { now: NOW });
    // 40 gun once gitmis, cooldown 60 → hala cooldown'da → match_waiting secilmez; A icin baska kural yok
    expect(r.decisions.filter((d) => d.userId === 'A')).toHaveLength(0);
    expect(r.noRule).toBe(1);
  });

  it('push_log 1000 satiri asinca da tamami okunur (sayfalama) — tavan sayimi kirpilmaz', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({ ...sentRow('A', 'lifecycle_likes_waiting', ago(2 * D)), id: i + 1 }));
    const { runEngine } = await boot(seed({}, { push_log: rows }));
    const r = await runEngine('live', { now: NOW });
    expect(r.decisions[0]).toMatchObject({ userId: 'A', decision: 'suppressed', reason: 'weekly_cap' });
  });

  it('holdout: kovasi esigin altindaki kullanici holdout, ustundeki gonderim alir (deterministik hash)', async () => {
    // Sema holdout_pct'yi 50 ile sinirlar; kova < 50 olan bir id ile kova >= 50 olan bir id seciyoruz.
    const { holdoutBucket } = await import('../../../src/services/notification-engine/engine.js');
    const ids = Array.from({ length: 200 }, (_, i) => `user-${i}`);
    const inHoldout = ids.find((id) => holdoutBucket(id) < 50)!;
    const outHoldout = ids.find((id) => holdoutBucket(id) >= 50)!;
    const tables = seed({ dry_run: false, holdout_pct: 50 });
    tables.users = [user({ id: inHoldout }), user({ id: outHoldout, created_at: ago(50 * D) }), user({ id: 'B', name: 'Bora', locale: 'en', lng: 0 })];
    tables.matches = [
      { id: 'm1', user1_id: inHoldout, user2_id: 'B', matched_at: ago(3 * D), is_active: true },
      { id: 'm2', user1_id: outHoldout, user2_id: 'B', matched_at: ago(3 * D), is_active: true },
    ];
    const { runEngine, send } = await boot(tables);
    const r = await runEngine('live', { now: NOW });
    expect(r.decisions.map((d) => [d.userId, d.decision])).toEqual([
      [inHoldout, 'holdout'],
      [outHoldout, 'sent'],
    ]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('kategori tercihi kapali → pref_off, inbox satiri da yazilmaz', async () => {
    const tables = seed({ dry_run: false });
    tables.users![0]!.notification_preferences = { matches: false, messages: true, campaigns: true };
    const { fake, runEngine, send } = await boot(tables);
    const r = await runEngine('live', { now: NOW });
    expect(r.decisions[0]).toMatchObject({ decision: 'suppressed', reason: 'pref_off' });
    expect(fake.table('notifications')).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('kural kapaliysa (config) atlanir', async () => {
    const { runEngine } = await boot(seed({ rules: { lifecycle_match_waiting: { enabled: false } } }));
    const r = await runEngine('live', { now: NOW });
    expect(r.noRule).toBe(1);
    expect(r.decisions).toHaveLength(0);
  });

  it('push_messages ile susturulmus sablon → template_muted', async () => {
    const { runEngine } = await boot(
      seed({}, { push_messages: [{ type: 'lifecycle_match_waiting', locale: 'tr', title: null, body: null, is_active: false }] }),
    );
    const r = await runEngine('live', { now: NOW });
    expect(r.decisions[0]).toMatchObject({ decision: 'suppressed', reason: 'template_muted' });
  });
});

describe('runEngine — simulasyon (backoffice onizleme)', () => {
  it('pencere yok sayilir, her dilde metin cozulur, kayit ve gonderim yok', async () => {
    const { fake, runEngine, send } = await boot(seed({ dry_run: false }));
    const r = await runEngine('simulate', { now: NOW });
    expect(r.mode).toBe('simulate');
    expect(r.outsideWindow).toBe(0);
    expect(r.decisions.map((d) => [d.userId, d.decision, d.locale, d.title])).toEqual([
      ['A', 'dry_run', 'tr', 'Eşleşmen seni bekliyor'],
      ['B', 'dry_run', 'en', 'Your match is waiting'],
    ]);
    expect(fake.table('push_log')).toHaveLength(0);
    expect(fake.table('notifications')).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });
});
