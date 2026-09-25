import { describe, it, expect, vi } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';
import type { Tables, Row, FakeSupabaseOptions } from '../helpers/fake-supabase.js';

/**
 * Tekrarlayan kampanya gondericisi — gercek servisler (recurring → segment → notification.service),
 * sadece DB (fake-supabase) ve FCM (send spy) taklit.
 * Kampanya penceresi 12-21 yerel. tr kullanicisi UTC+3.
 */
const H = 3600 * 1000;
const D = 24 * H;
const CAMPAIGN_ID = 'camp-1';

function user(overrides: Row & { id: string }): Row {
  return {
    push_token: `tok-${overrides.id}`,
    locale: 'tr',
    lng: 29,
    is_deleted: false,
    is_banned: false,
    is_test_account: false,
    is_seed_profile: false,
    notification_preferences: null,
    ...overrides,
  };
}

function campaign(overrides: Row = {}): Row {
  return {
    id: CAMPAIGN_ID,
    status: 'scheduled',
    recurrence: 'daily',
    push_title: 'Ana baslik',
    push_body: 'Ana govde',
    image_url: null,
    action_url: '/discover',
    action_label: null,
    segment: {},
    recurrence_days: null,
    window_start_hour: 12,
    window_end_hour: 21,
    variants: [],
    ...overrides,
  };
}

function tables(extra: Partial<Tables> = {}): Tables {
  return {
    notification_engine_config: [{ id: 1, config: { dry_run: true, holdout_pct: 0 } }],
    campaigns: [campaign()],
    campaign_stats: [{ id: 's1', campaign_id: CAMPAIGN_ID, total_targeted: 0, total_sent: 0, total_delivered: 0 }],
    campaign_events: [],
    users: [user({ id: 'A' })],
    push_log: [],
    notifications: [],
    push_messages: [],
    ...extra,
  };
}

async function boot(seed: Tables, opts: { fcm?: boolean; options?: FakeSupabaseOptions; send?: ReturnType<typeof vi.fn> } = {}) {
  vi.resetModules();
  const fake = createFakeSupabase(seed, { unique: { campaign_events: ['dedupe_key'] }, ...(opts.options ?? {}) });
  const send = opts.send ?? vi.fn().mockResolvedValue('msg-1');
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client, ensureStorageBuckets: async () => {} }));
  vi.doMock('../../src/config/firebase.js', () => ({ getFcm: () => ({ send }), isFcmAvailable: () => opts.fcm ?? true, firebaseAdmin: {} }));
  const mod = await import('../../src/services/campaign-recurring.service.js');
  return { fake, send, ...mod };
}

/**
 * Kampanya+gun icin secilen dakikadan `offsetMin` sonrasi (UTC) — tr kullanicisi icin yerel = UTC+3.
 * Guard: hash degisip slot+offset pencereyi asarsa test "after_window" ile degil, acik mesajla dussun.
 */
async function atSlot(localDate: string, offsetMin: number, startHour = 12, endHour = 21) {
  const { sendMinuteFor } = await import('../../src/services/campaign-recurring.service.js');
  const minute = sendMinuteFor(CAMPAIGN_ID, localDate, startHour, endHour) + offsetMin;
  expect(minute, `slot+offset pencereyi asti (${minute} >= ${endHour * 60}) — CAMPAIGN_ID/hash degisti mi?`).toBeLessThan(endHour * 60);
  const utcMinute = minute - 3 * 60;
  return new Date(Date.parse(`${localDate}T00:00:00.000Z`) + utcMinute * 60 * 1000);
}

describe('sendMinuteFor / variantFor / isRecurrenceDay (saf)', () => {
  it('dakika pencere icinde kalir, ayni gun icin sabit, gunden gune degisir', async () => {
    const { sendMinuteFor } = await boot(tables());
    const a = sendMinuteFor('c', '2026-09-25', 12, 21);
    expect(a).toBeGreaterThanOrEqual(12 * 60);
    expect(a).toBeLessThan(21 * 60);
    expect(sendMinuteFor('c', '2026-09-25', 12, 21)).toBe(a);
    const week = Array.from({ length: 7 }, (_, i) => sendMinuteFor('c', `2026-09-2${i + 1}`, 12, 21));
    expect(new Set(week).size).toBeGreaterThan(1);
  });

  it('variantFor: ardisik gunlerde ardisik varyant; varyant yoksa ana metin', async () => {
    const { variantFor } = await boot(tables());
    const c = { push_title: 'T', push_body: 'B', variants: [{ title: 'v1', body: 'b1' }, { title: 'v2', body: 'b2' }] };
    expect(variantFor(c, 10)).toEqual({ title: 'v1', body: 'b1' });
    expect(variantFor(c, 11)).toEqual({ title: 'v2', body: 'b2' });
    expect(variantFor(c, 12)).toEqual({ title: 'v1', body: 'b1' });
    expect(variantFor({ ...c, variants: [] }, 5)).toEqual({ title: 'T', body: 'B' });
  });

  it('isRecurrenceDay: bos/null her gun, liste varsa yalniz o gunler', async () => {
    const { isRecurrenceDay } = await boot(tables());
    expect(isRecurrenceDay(null, 3)).toBe(true);
    expect(isRecurrenceDay([], 3)).toBe(true);
    expect(isRecurrenceDay([2, 4, 6], 4)).toBe(true);
    expect(isRecurrenceDay([2, 4, 6], 3)).toBe(false);
  });
});

describe('campaignRecurringService.dispatch', () => {
  it('slot gecince gonderir: claim (dedupe_key) + FCM + delivered + rpc sayaclari + inbox satiri', async () => {
    const { fake, send, campaignRecurringService } = await boot(tables({ campaigns: [campaign({ variants: [{ title: 'v1', body: 'b1' }] })] }));
    const now = await atSlot('2026-09-25', 5);
    const r = await campaignRecurringService.dispatch(now);

    expect(r.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ token: 'tok-A', notification: { title: 'v1', body: 'b1' } });
    const events = fake.table('campaign_events');
    expect(events.map((e) => e.event)).toEqual(['sent', 'delivered']);
    expect(events[0]!.dedupe_key).toBe(`${CAMPAIGN_ID}:A:2026-09-25`);
    expect(fake.rpcCalls.map((c) => (c.args as { p_field: string }).p_field)).toEqual(['total_sent', 'total_delivered']);
    expect(fake.table('notifications')).toHaveLength(1);
    expect(fake.table('notifications')[0]).toMatchObject({ user_id: 'A', type: 'campaign', campaign_id: CAMPAIGN_ID });
    expect(fake.table('campaign_stats')[0]!.total_targeted).toBe(1);
  });

  it('slot gelmeden gondermez (before_slot); pencere kapaninca da gondermez (after_window)', async () => {
    const { send, campaignRecurringService } = await boot(tables());
    const early = await campaignRecurringService.dispatch(await atSlot('2026-09-25', -1));
    expect(early.skipped.before_slot).toBe(1);
    // 21:00 yerel = 18:00 UTC
    const late = await campaignRecurringService.dispatch(new Date('2026-09-25T18:00:00.000Z'));
    expect(late.skipped.after_window).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('ayni gun ikinci tik tekrar gondermez (already_sent); ertesi gun yeniden gider', async () => {
    const { send, campaignRecurringService } = await boot(tables());
    await campaignRecurringService.dispatch(await atSlot('2026-09-25', 5));
    const again = await campaignRecurringService.dispatch(await atSlot('2026-09-25', 20));
    expect(again.skipped.already_sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    // Iki gun sonra (ardisik gunlerde 20 saatlik gunluk tavan mesru olarak carpisabilir): yeniden gider
    const next = await campaignRecurringService.dispatch(await atSlot('2026-09-27', 5));
    expect(next.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('dedupe yerel gune bagli: dun gec (20:50) gonderildiyse bugun 12:05 slotu daily_cap ile ertelenir, 17:00 tikinde gider', async () => {
    // 25'i 23:30 yerel gonderim (dedupe_key 25'i) → 26'si slot (12-21 arasi, <20 saat sonra): already_sent DEGIL, daily_cap
    const yesterday = new Date('2026-09-25T20:30:00.000Z');
    const seed = tables({
      campaign_events: [{ id: 'e0', campaign_id: CAMPAIGN_ID, user_id: 'A', event: 'sent', dedupe_key: `${CAMPAIGN_ID}:A:2026-09-25`, created_at: yesterday.toISOString() }],
      notifications: [{ id: 'n0', user_id: 'A', type: 'campaign', created_at: yesterday.toISOString() }],
    });
    const { send, campaignRecurringService } = await boot(seed);
    const slotTick = await atSlot('2026-09-26', 0);
    expect(slotTick.getTime() - yesterday.getTime()).toBeLessThan(20 * H); // testin on kosulu: slot gunluk pencere icinde
    const atSlotResult = await campaignRecurringService.dispatch(slotTick);
    expect(atSlotResult.skipped.daily_cap).toBe(1);
    expect(atSlotResult.skipped.already_sent).toBe(0);
    const late = await campaignRecurringService.dispatch(new Date('2026-09-26T17:00:00.000Z')); // 20:00 yerel, 20,5 saat gecti, pencere acik
    expect(late.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('claim baska instance tarafindan yazilmissa (23505) gonderim yok — claimed_elsewhere', async () => {
    // Claim seti 2 gun geriye bakar; kayit eski tarihli ama key bugunku → set'e girmez, insert unique'e carpar
    const seed = tables({
      campaign_events: [{ id: 'e0', campaign_id: CAMPAIGN_ID, user_id: 'A', event: 'sent', dedupe_key: `${CAMPAIGN_ID}:A:2026-09-25`, created_at: '2026-09-20T00:00:00.000Z' }],
    });
    const { send, campaignRecurringService } = await boot(seed);
    const r = await campaignRecurringService.dispatch(await atSlot('2026-09-25', 5));
    expect(r.skipped.claimed_elsewhere).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('gunluk tavan: bugun lifecycle push almis kullaniciya gitmez; haftalik tavan: 3 gonderim varsa gitmez', async () => {
    const now = await atSlot('2026-09-25', 5);
    const daily = tables({ push_log: [{ id: 1, user_id: 'A', rule_key: 'lifecycle_winback', decision: 'sent', created_at: new Date(now.getTime() - 2 * H).toISOString() }] });
    const a = await boot(daily);
    expect((await a.campaignRecurringService.dispatch(now)).skipped.daily_cap).toBe(1);

    const weekly = tables({
      push_log: [2, 3, 4].map((d) => ({ id: d, user_id: 'A', rule_key: 'lifecycle_new_people', decision: 'sent', created_at: new Date(now.getTime() - d * D).toISOString() })),
    });
    const b = await boot(weekly);
    expect((await b.campaignRecurringService.dispatch(now)).skipped.weekly_cap).toBe(1);
    expect(a.send).not.toHaveBeenCalled();
    expect(b.send).not.toHaveBeenCalled();
  });

  it('holdout kovasi motorla ayni (throttle.ts): holdout_pct=50 → A (kova 12) tutulur, B (kova 69) gider; 0 → ikisi de gider', async () => {
    const { holdoutBucket } = await import('../../src/services/notification-engine/throttle.js');
    expect([holdoutBucket('A'), holdoutBucket('B')]).toEqual([12, 69]); // sabit beklenti: hash degisirse burasi kirmizi olsun
    const seed = tables({ notification_engine_config: [{ id: 1, config: { holdout_pct: 50 } }], users: [user({ id: 'A' }), user({ id: 'B' })] });
    const a = await boot(seed);
    const r = await a.campaignRecurringService.dispatch(await atSlot('2026-09-25', 5));
    expect(r.skipped.holdout).toBe(1);
    expect(r.sent).toBe(1);
    expect(a.send.mock.calls[0]![0]).toMatchObject({ token: 'tok-B' });

    const b = await boot(tables({ notification_engine_config: [{ id: 1, config: { holdout_pct: 0 } }], users: [user({ id: 'A' }), user({ id: 'B' })] }));
    expect((await b.campaignRecurringService.dispatch(await atSlot('2026-09-25', 5))).sent).toBe(2);
  });

  it('segment 1000 satirda kirpilmaz: 1001 uygun kullanicinin hepsine gider (fetchAll sayfalama)', async () => {
    const many = Array.from({ length: 1001 }, (_, i) => user({ id: `u${String(i).padStart(4, '0')}` }));
    const { send, campaignRecurringService, fake } = await boot(tables({ users: many, notification_engine_config: [{ id: 1, config: { holdout_pct: 0 } }] }));
    const r = await campaignRecurringService.dispatch(await atSlot('2026-09-25', 5));
    expect(r.sent).toBe(1001);
    expect(send).toHaveBeenCalledTimes(1001);
    expect(fake.table('campaign_stats')[0]!.total_targeted).toBe(1001);
  });

  it('decideRecurringSkip (saf): oncelik sirasi not_day > after_window > before_slot > already_sent > tavan/holdout > pref_off', async () => {
    const { decideRecurringSkip, dedupeKeyFor } = await boot(tables());
    const c = campaign() as unknown as import('../../src/services/campaign-recurring.service.js').RecurringCampaign;
    const u = user({ id: 'A' }) as unknown as import('../../src/services/segment.service.js').SegmentTarget;
    const clock = { hour: 13, minuteOfDay: 13 * 60, date: '2026-09-25', isoWeekday: 5, dayIndex: 20721 };
    const cfg = { daily_cap: 1, weekly_cap: 3, holdout_pct: 0 };
    const base = { campaign: c, user: u, clock, claimed: new Set<string>(), sendTimes: new Map<string, number[]>(), config: cfg, nowMs: Date.parse('2026-09-25T10:00:00Z') };
    // 13:00 slot'tan once mi sonra mi hash'e bagli → slot'u hesapla, ona gore iki yonu de sina
    const { sendMinuteFor } = await import('../../src/services/campaign-recurring.service.js');
    const slot = sendMinuteFor(c.id, clock.date, c.window_start_hour, c.window_end_hour);
    expect(decideRecurringSkip({ ...base, clock: { ...clock, minuteOfDay: slot - 1 } })).toBe('before_slot');
    expect(decideRecurringSkip({ ...base, clock: { ...clock, minuteOfDay: slot } })).toBeNull();
    expect(decideRecurringSkip({ ...base, clock: { ...clock, minuteOfDay: 21 * 60 } })).toBe('after_window');
    expect(decideRecurringSkip({ ...base, campaign: { ...c, recurrence_days: [1] }, clock: { ...clock, minuteOfDay: slot } })).toBe('not_day');
    expect(decideRecurringSkip({ ...base, clock: { ...clock, minuteOfDay: slot }, claimed: new Set([dedupeKeyFor(c.id, 'A', '2026-09-25')]) })).toBe('already_sent');
    expect(decideRecurringSkip({ ...base, clock: { ...clock, minuteOfDay: slot }, sendTimes: new Map([['A', [base.nowMs - 1000]]]) })).toBe('daily_cap');
    expect(decideRecurringSkip({ ...base, clock: { ...clock, minuteOfDay: slot }, user: { ...u, notification_preferences: { campaigns: false } } })).toBe('pref_off');
  });

  it('haftanin gunu listede degilse gitmez (not_day); kampanya tercihi kapaliysa inbox satiri bile yazilmaz (pref_off)', async () => {
    // 2026-09-25 Cuma = ISO 5
    const dayOff = tables({ campaigns: [campaign({ recurrence_days: [1, 3] })] });
    const a = await boot(dayOff);
    expect((await a.campaignRecurringService.dispatch(await atSlot('2026-09-25', 5))).skipped.not_day).toBe(1);

    const prefOff = tables({ users: [user({ id: 'A', notification_preferences: { campaigns: false } })] });
    const b = await boot(prefOff);
    const r = await b.campaignRecurringService.dispatch(await atSlot('2026-09-25', 5));
    expect(r.skipped.pref_off).toBe(1);
    expect(b.fake.table('notifications')).toHaveLength(0);
    expect(b.fake.table('campaign_events')).toHaveLength(0);
  });

  it('test/seed/banli/token\'siz kullanicilar hedef degil; paused kampanya calismaz; FCM yoksa dokunmaz', async () => {
    const seed = tables({
      users: [
        user({ id: 'A' }),
        user({ id: 'T', is_test_account: true }),
        user({ id: 'S', is_seed_profile: true }),
        user({ id: 'B', is_banned: true }),
        user({ id: 'N', push_token: null }),
      ],
    });
    const a = await boot(seed);
    const r = await a.campaignRecurringService.dispatch(await atSlot('2026-09-25', 5));
    expect(r.sent).toBe(1);
    expect(a.fake.table('campaign_stats')[0]!.total_targeted).toBe(1);

    const paused = tables({ campaigns: [campaign({ status: 'paused' })] });
    const b = await boot(paused);
    expect((await b.campaignRecurringService.dispatch(await atSlot('2026-09-25', 5))).campaigns).toBe(0);

    const c = await boot(tables(), { fcm: false });
    const r3 = await c.campaignRecurringService.dispatch(await atSlot('2026-09-25', 5));
    expect(r3.campaigns).toBe(0);
    expect(c.fake.table('campaign_events')).toHaveLength(0);
  });

  it('FCM hata verirse sent kaydi kalir, delivered yazilmaz, failed sayilir (tekrar denenmez)', async () => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error('fcm down'), { code: 'messaging/internal-error' }));
    const { fake, campaignRecurringService } = await boot(tables(), { send });
    const r = await campaignRecurringService.dispatch(await atSlot('2026-09-25', 5));
    expect(r.failed).toBe(1);
    expect(r.sent).toBe(0);
    expect(fake.table('campaign_events').map((e) => e.event)).toEqual(['sent']);
  });
});
