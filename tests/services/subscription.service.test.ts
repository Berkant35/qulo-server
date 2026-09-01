import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';

/**
 * Abonelik = para. Fixture limitleri: free(discover 50, undo 0, soru 3, bonus 0),
 * plus(200/3/5/200), premium(500/10/10/1000).
 */
async function setup(seed: Tables, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase(
    { economy_config_versions: [activeConfigRow()], ...seed },
    options,
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { subscriptionService } = await import('../../src/services/subscription.service.js');
  return { fake, subscriptionService };
}

const NOW = new Date('2026-09-01T12:00:00Z');
const FUTURE = '2026-10-01T12:00:00Z';
const PAST = '2026-08-01T12:00:00Z';

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  green_diamonds: 0,
  purple_diamonds: 0,
  subscription_plan: null,
  subscription_expires_at: null,
  rc_customer_id: null,
  daily_swipes_used: 0,
  daily_undos_used: 0,
  daily_swipes_reset_at: NOW.toISOString(),
  ...over,
});

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getStatus', () => {
  it('aboneliği olmayan kullanıcı için boş durum', async () => {
    const { subscriptionService } = await setup({ users: [user()] });
    await expect(subscriptionService.getStatus('u1')).resolves.toEqual({
      plan: null, status: null, expiresAt: null, isActive: false,
    });
  });

  it('geçerli abonelik active döner', async () => {
    const { subscriptionService } = await setup({
      users: [user({ subscription_plan: 'plus', subscription_expires_at: FUTURE })],
    });
    await expect(subscriptionService.getStatus('u1')).resolves.toMatchObject({
      plan: 'plus', status: 'active', isActive: true,
    });
  });

  it('süresi geçmiş abonelik expired döner ve aktif sayılmaz', async () => {
    const { subscriptionService } = await setup({
      users: [user({ subscription_plan: 'premium', subscription_expires_at: PAST })],
    });
    await expect(subscriptionService.getStatus('u1')).resolves.toMatchObject({
      plan: 'premium', status: 'expired', isActive: false,
    });
  });

  it('plan var ama bitiş tarihi yoksa aktif sayılmaz', async () => {
    const { subscriptionService } = await setup({
      users: [user({ subscription_plan: 'plus', subscription_expires_at: null })],
    });
    await expect(subscriptionService.getStatus('u1')).resolves.toMatchObject({ isActive: false });
  });

  it('kullanıcı yoksa hata atmaz, boş durum döner', async () => {
    const { subscriptionService } = await setup({ users: [] });
    await expect(subscriptionService.getStatus('yok')).resolves.toMatchObject({ isActive: false });
  });
});

describe('activateSubscription', () => {
  it('kullanıcıyı günceller, kayıt açar ve aylık bonusu yatırır', async () => {
    const { fake, subscriptionService } = await setup({ users: [user()] });

    await subscriptionService.activateSubscription('u1', 'plus', 'rc-1', 'tx-1', FUTURE);

    expect(fake.table('users')[0]).toMatchObject({
      subscription_plan: 'plus',
      subscription_expires_at: FUTURE,
      rc_customer_id: 'rc-1',
      purple_diamonds: 200, // fixture: plus bonus
    });
    expect(fake.table('user_subscriptions')[0]).toMatchObject({
      user_id: 'u1', plan: 'plus', status: 'active', store_transaction_id: 'tx-1',
    });
  });

  it('premium bonusu plus\'tan yüksek — tutar config\'ten okunur', async () => {
    const { fake, subscriptionService } = await setup({ users: [user()] });
    await subscriptionService.activateSubscription('u1', 'premium', 'rc-1', 'tx-1', FUTURE);
    expect(fake.table('users')[0].purple_diamonds).toBe(1000);
  });

  /** Webhook tekrarı gerçek bir senaryo — aynı transaction bonusu iki kez yatırmamalı. */
  it('aynı store_transaction_id ile ikinci çağrı bonusu tekrar yatırmaz', async () => {
    const { fake, subscriptionService } = await setup({ users: [user()] });

    await subscriptionService.activateSubscription('u1', 'plus', 'rc-1', 'tx-1', FUTURE);
    await subscriptionService.activateSubscription('u1', 'plus', 'rc-1', 'tx-1', FUTURE);

    expect(fake.table('users')[0].purple_diamonds).toBe(200);
  });

  it('farklı transaction ayrı bonus sayılır', async () => {
    const { fake, subscriptionService } = await setup({ users: [user()] });

    await subscriptionService.activateSubscription('u1', 'plus', 'rc-1', 'tx-1', FUTURE);
    await subscriptionService.activateSubscription('u1', 'plus', 'rc-1', 'tx-2', FUTURE);

    expect(fake.table('users')[0].purple_diamonds).toBe(400);
  });

  // SubscriptionPlan = 'plus' | 'premium' — 'free' aktive edilebilir bir plan değil,
  // bu yüzden bonusu 0 senaryosu config'i değiştirerek kuruluyor.
  it('bonusu 0 olan tier için elmas yatırmaz ve işlem kaydı açmaz', async () => {
    const base = activeConfigRow().config;
    const fake = createFakeSupabase({
      economy_config_versions: [activeConfigRow({
        subscriptionLimits: {
          ...base.subscriptionLimits,
          plus: { ...base.subscriptionLimits.plus, monthlyPurpleBonus: 0 },
        },
      })],
      users: [user()],
    });
    vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
    const { subscriptionService } = await import('../../src/services/subscription.service.js');

    await subscriptionService.activateSubscription('u1', 'plus', 'rc-1', 'tx-1', FUTURE);

    expect(fake.table('users')[0].purple_diamonds).toBe(0);
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });
});

describe('renewSubscription', () => {
  it('bitiş tarihini uzatır ve bonusu yeniden yatırır', async () => {
    const { fake, subscriptionService } = await setup({
      users: [user({ subscription_plan: 'plus', subscription_expires_at: PAST, purple_diamonds: 0 })],
      user_subscriptions: [{ id: 's1', user_id: 'u1', plan: 'plus', status: 'active' }],
    });

    await subscriptionService.renewSubscription('u1', 'tx-renew', FUTURE);

    expect(fake.table('users')[0].subscription_expires_at).toBe(FUTURE);
    expect(fake.table('users')[0].purple_diamonds).toBe(200);
    expect(fake.table('user_subscriptions')[0]).toMatchObject({
      status: 'active', expires_at: FUTURE, store_transaction_id: 'tx-renew',
    });
  });

  it('planı olmayan kullanıcıda plus\'a düşer (varsayılan)', async () => {
    const { fake, subscriptionService } = await setup({
      users: [user({ subscription_plan: null })],
      user_subscriptions: [{ id: 's1', user_id: 'u1', status: 'active' }],
    });

    await subscriptionService.renewSubscription('u1', 'tx-1', FUTURE);
    expect(fake.table('users')[0].purple_diamonds).toBe(200);
  });

  it('aynı transaction ile ikinci yenileme bonusu tekrar vermez', async () => {
    const { fake, subscriptionService } = await setup({
      users: [user({ subscription_plan: 'premium' })],
      user_subscriptions: [{ id: 's1', user_id: 'u1', status: 'active' }],
    });

    await subscriptionService.renewSubscription('u1', 'tx-1', FUTURE);
    await subscriptionService.renewSubscription('u1', 'tx-1', FUTURE);

    expect(fake.table('users')[0].purple_diamonds).toBe(1000);
  });
});

describe('cancelSubscription', () => {
  it('kaydı cancelled yapar ama kullanıcının erişimini hemen kesmez', async () => {
    const { fake, subscriptionService } = await setup({
      users: [user({ subscription_plan: 'plus', subscription_expires_at: FUTURE })],
      user_subscriptions: [{ id: 's1', user_id: 'u1', status: 'active' }],
    });

    await subscriptionService.cancelSubscription('u1');

    expect(fake.table('user_subscriptions')[0].status).toBe('cancelled');
    // Süre sonuna kadar aktif kalmalı — iptal anında erişim kesilmiyor.
    expect(fake.table('users')[0].subscription_plan).toBe('plus');
    await expect(subscriptionService.getStatus('u1')).resolves.toMatchObject({ isActive: true });
  });

  it('zaten iptal edilmiş kaydı tekrar değiştirmez', async () => {
    const { fake, subscriptionService } = await setup({
      users: [user()],
      user_subscriptions: [{ id: 's1', user_id: 'u1', status: 'cancelled', updated_at: 'eski' }],
    });

    await subscriptionService.cancelSubscription('u1');
    expect(fake.table('user_subscriptions')[0].updated_at).toBe('eski');
  });

  it('başka kullanıcının aboneliğine dokunmaz', async () => {
    const { fake, subscriptionService } = await setup({
      users: [user()],
      user_subscriptions: [
        { id: 's1', user_id: 'u1', status: 'active' },
        { id: 's2', user_id: 'u2', status: 'active' },
      ],
    });

    await subscriptionService.cancelSubscription('u1');
    expect(fake.table('user_subscriptions').find((r) => r.user_id === 'u2')!.status).toBe('active');
  });
});

describe('expireSubscription', () => {
  it('planı temizler ve kaydı expired yapar', async () => {
    const { fake, subscriptionService } = await setup({
      users: [user({ subscription_plan: 'premium', subscription_expires_at: FUTURE })],
      user_subscriptions: [{ id: 's1', user_id: 'u1', status: 'active' }],
    });

    await subscriptionService.expireSubscription('u1');

    expect(fake.table('users')[0]).toMatchObject({
      subscription_plan: null, subscription_expires_at: null,
    });
    expect(fake.table('user_subscriptions')[0].status).toBe('expired');
  });

  it('süre dolduktan sonra free limitlerine döner', async () => {
    const { subscriptionService } = await setup({
      users: [user({ subscription_plan: 'premium', subscription_expires_at: FUTURE })],
    });

    await subscriptionService.expireSubscription('u1');
    const stats = await subscriptionService.getDailyStats('u1');

    expect(stats.dailyDiscoversLimit).toBe(50);
    expect(stats.dailyUndosLimit).toBe(0);
    expect(stats.questionsLimit).toBe(3);
  });
});

describe('changeSubscription', () => {
  it('plus → premium yükseltmede yeni tier ve bonusu uygular', async () => {
    const { fake, subscriptionService } = await setup({
      users: [user({ subscription_plan: 'plus', subscription_expires_at: FUTURE, rc_customer_id: 'rc-1' })],
      user_subscriptions: [{ id: 's1', user_id: 'u1', plan: 'plus', status: 'active' }],
    });

    await subscriptionService.changeSubscription('u1', 'premium', 'tx-up', FUTURE);

    expect(fake.table('users')[0]).toMatchObject({
      subscription_plan: 'premium', purple_diamonds: 1000,
    });
  });

  it('premium → plus düşürmede rc_customer_id korunur', async () => {
    const { fake, subscriptionService } = await setup({
      users: [user({ subscription_plan: 'premium', subscription_expires_at: FUTURE, rc_customer_id: 'rc-9' })],
      user_subscriptions: [{ id: 's1', user_id: 'u1', plan: 'premium', status: 'active' }],
    });

    await subscriptionService.changeSubscription('u1', 'plus', 'tx-down', FUTURE);

    expect(fake.table('users')[0]).toMatchObject({
      subscription_plan: 'plus', rc_customer_id: 'rc-9',
    });
  });

  it('eski kaydı expired yapar, yenisini açar', async () => {
    const { fake, subscriptionService } = await setup({
      users: [user({ subscription_plan: 'plus', subscription_expires_at: FUTURE })],
      user_subscriptions: [{ id: 's1', user_id: 'u1', plan: 'plus', status: 'active' }],
    });

    await subscriptionService.changeSubscription('u1', 'premium', 'tx-up', FUTURE);

    const rows = fake.table('user_subscriptions');
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === 's1')!.status).toBe('expired');
    expect(rows.find((r) => r.plan === 'premium')!.status).toBe('active');
  });
});

describe('getDailyStats', () => {
  it('aboneliksiz kullanıcıya free limitleri verir', async () => {
    const { subscriptionService } = await setup({ users: [user()] });
    const stats = await subscriptionService.getDailyStats('u1');

    expect(stats).toMatchObject({
      dailyDiscoversLimit: 50, dailyUndosLimit: 0,
      questionsLimit: 3, monthlyPurpleBonus: 0, passportMode: false, hasAds: true,
    });
  });

  it('aktif aboneliğe tier limitlerini verir', async () => {
    const { subscriptionService } = await setup({
      users: [user({ subscription_plan: 'premium', subscription_expires_at: FUTURE })],
    });
    const stats = await subscriptionService.getDailyStats('u1');

    expect(stats).toMatchObject({
      dailyDiscoversLimit: 500, dailyUndosLimit: 10, passportMode: true, hasAds: false,
    });
  });

  /** Süresi geçmiş plan hâlâ users satırında duruyor — free'ye düşmesi şart. */
  it('süresi geçmiş plan free limitlerine düşürülür', async () => {
    const { subscriptionService } = await setup({
      users: [user({ subscription_plan: 'premium', subscription_expires_at: PAST })],
    });
    const stats = await subscriptionService.getDailyStats('u1');
    expect(stats.dailyDiscoversLimit).toBe(50);
  });

  it('dünden kalan sayaçları sıfırlar (lazy reset)', async () => {
    const { fake, subscriptionService } = await setup({
      users: [user({
        daily_swipes_used: 40, daily_undos_used: 2,
        daily_swipes_reset_at: '2026-08-31T23:00:00Z',
      })],
    });

    const stats = await subscriptionService.getDailyStats('u1');

    expect(stats.dailyDiscoversUsed).toBe(0);
    expect(stats.dailyUndosUsed).toBe(0);
    expect(fake.table('users')[0].daily_swipes_used).toBe(0);
  });

  it('aynı gün içindeki sayaçları sıfırlamaz', async () => {
    const { subscriptionService } = await setup({
      users: [user({ daily_swipes_used: 40, daily_swipes_reset_at: '2026-09-01T01:00:00Z' })],
    });

    await expect(subscriptionService.getDailyStats('u1')).resolves.toMatchObject({
      dailyDiscoversUsed: 40,
    });
  });

  it('sadece kendi sorularını sayar', async () => {
    const { subscriptionService } = await setup({
      users: [user()],
      questions: [
        { id: 'q1', user_id: 'u1' }, { id: 'q2', user_id: 'u1' }, { id: 'q3', user_id: 'u2' },
      ],
    });

    await expect(subscriptionService.getDailyStats('u1')).resolves.toMatchObject({
      questionsCreated: 2,
    });
  });

  it('kullanıcı yoksa USER_NOT_FOUND', async () => {
    const { subscriptionService } = await setup({ users: [] });
    await expect(subscriptionService.getDailyStats('yok')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
  });
});

describe('incrementDailySwipes / incrementDailyUndos', () => {
  it('sayacı artırır', async () => {
    const { fake, subscriptionService } = await setup({ users: [user({ daily_swipes_used: 5 })] });
    await subscriptionService.incrementDailySwipes('u1');
    expect(fake.table('users')[0].daily_swipes_used).toBe(6);
  });

  it('limit dolunca reddeder ve sayacı artırmaz', async () => {
    const { fake, subscriptionService } = await setup({ users: [user({ daily_swipes_used: 50 })] });

    await expect(subscriptionService.incrementDailySwipes('u1')).rejects.toMatchObject({
      code: 'DAILY_LIMIT_EXCEEDED',
    });
    expect(fake.table('users')[0].daily_swipes_used).toBe(50);
  });

  it('free tier undo limiti 0 — ilk denemede reddeder', async () => {
    const { subscriptionService } = await setup({ users: [user({ daily_undos_used: 0 })] });
    await expect(subscriptionService.incrementDailyUndos('u1')).rejects.toMatchObject({
      code: 'DAILY_LIMIT_EXCEEDED',
    });
  });

  it('premium undo limitine kadar izin verir', async () => {
    const { fake, subscriptionService } = await setup({
      users: [user({
        subscription_plan: 'premium', subscription_expires_at: FUTURE, daily_undos_used: 9,
      })],
    });

    await subscriptionService.incrementDailyUndos('u1');
    expect(fake.table('users')[0].daily_undos_used).toBe(10);

    await expect(subscriptionService.incrementDailyUndos('u1')).rejects.toMatchObject({
      code: 'DAILY_LIMIT_EXCEEDED',
    });
  });
});

describe('getLimits', () => {
  it('plan null ise free limitleri', async () => {
    const { subscriptionService } = await setup({ users: [user()] });
    await expect(subscriptionService.getLimits(null)).resolves.toMatchObject({ dailyDiscovers: 50 });
  });

  it('limitler config\'ten gelir, hardcoded değil', async () => {
    const base = activeConfigRow().config;
    const fake = createFakeSupabase({
      economy_config_versions: [activeConfigRow({
        subscriptionLimits: {
          ...base.subscriptionLimits,
          free: { ...base.subscriptionLimits.free, dailyDiscovers: 77 },
        },
      })],
    });
    vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
    const { subscriptionService } = await import('../../src/services/subscription.service.js');

    // getLimits(null) → free; 'free' SubscriptionPlan'da yok.
    await expect(subscriptionService.getLimits(null)).resolves.toMatchObject({ dailyDiscovers: 77 });
  });
});
