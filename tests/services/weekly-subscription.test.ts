import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';
import { activeConfigRow, economyConfigFixture } from '../helpers/economy-config.fixture.js';
import {
  SUBSCRIPTION_PRODUCT_MAP,
  SUBSCRIPTION_WEEKLY_PRODUCT_IDS,
  subscriptionPeriodOf,
} from '../../src/types/index.js';
import { economyConfigSchema } from '../../src/types/economy-config.schema.js';

/**
 * Plus Haftalık (2.2.0, B4 / K1) = para. Gerçek webhook/subscription/diamond servisleri, yalnız
 * Supabase ve RevenueCat GET /subscribers sahte. Fixture: plus aylık bonus 500 (canlı değer),
 * plus haftalık 100, premium aylık 1000.
 */
const MONTHLY = 'quloplusmonthly2';
const WEEKLY = SUBSCRIPTION_WEEKLY_PRODUCT_IDS.ios;
const PREMIUM = 'qulopremiummonthly2';

type StoreState = { plan: 'plus' | 'premium'; period: 'weekly' | 'monthly'; expiresAt: string } | null | 'off';
let store: StoreState = 'off';
const storeMock = {
  canSyncSubscriptions: () => store !== 'off',
  getActiveSubscription: async () => (store === 'off' ? null : store),
};

const NOW = new Date('2026-11-18T12:00:00Z');
const WEEK = 7 * 24 * 3600 * 1000;
const T1 = NOW.getTime() + WEEK;          // ilk haftalık dönem bitişi
const T2 = T1 + WEEK;                      // ikinci
const MONTH_END = NOW.getTime() + 30 * 24 * 3600 * 1000;

const event = (over: Record<string, unknown> = {}) => ({
  type: 'INITIAL_PURCHASE',
  app_user_id: 'u1',
  product_id: WEEKLY,
  store: 'APP_STORE',
  expiration_at_ms: T1,
  transaction_id: 'tx-w1',
  ...over,
});

function configRow() {
  return activeConfigRow({
    subscriptionLimits: {
      ...economyConfigFixture.subscriptionLimits,
      plus: { ...economyConfigFixture.subscriptionLimits.plus, monthlyPurpleBonus: 500, dailyDiscovers: 999999, dailyUndos: 3, hasAds: false },
    },
  });
}

async function setup(seed: Tables = {}, configOverride?: Record<string, unknown>) {
  vi.resetModules();
  const row = configOverride ? { ...configRow(), config: configOverride } : configRow();
  const fake = createFakeSupabase({
    economy_config_versions: [row],
    users: [{
      id: 'u1', green_diamonds: 0, purple_diamonds: 0,
      subscription_plan: null, subscription_period: null, subscription_expires_at: null, rc_customer_id: null,
      daily_swipes_used: 0, daily_undos_used: 0, daily_swipes_reset_at: NOW.toISOString(),
    }],
    ...seed,
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  vi.doMock('../../src/services/revenuecat.service.js', () => ({ revenueCatService: storeMock }));
  const { webhookService } = await import('../../src/services/webhook.service.js');
  const { subscriptionService } = await import('../../src/services/subscription.service.js');
  return { fake, webhookService, subscriptionService };
}

type Fake = Awaited<ReturnType<typeof setup>>['fake'];
const bonuses = (fake: Fake) => fake.table('diamond_transactions').filter((r) => r.reason === 'SUBSCRIPTION_BONUS');
const user = (fake: Fake) => fake.table('users')[0];

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  store = 'off';
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ürün → plan/dönem eşlemesi', () => {
  it('quloplusweekly iOS ve Android anahtarlarıyla plus planına çözülür (ayrı plan yok)', () => {
    expect(SUBSCRIPTION_PRODUCT_MAP[SUBSCRIPTION_WEEKLY_PRODUCT_IDS.ios]).toBe('plus');
    expect(SUBSCRIPTION_PRODUCT_MAP[SUBSCRIPTION_WEEKLY_PRODUCT_IDS.android]).toBe('plus');
    expect(SUBSCRIPTION_WEEKLY_PRODUCT_IDS.ios).toBe('quloplusweekly');
  });

  it('dönem: haftalık ürün (base plan ekli de) weekly, diğer tüm abonelik ürünleri monthly', () => {
    expect(subscriptionPeriodOf('quloplusweekly')).toBe('weekly');
    expect(subscriptionPeriodOf('quloplusweekly:quloplus-weekly')).toBe('weekly');
    expect(subscriptionPeriodOf('quloplusmonthly2')).toBe('monthly');
    expect(subscriptionPeriodOf('qulopremiummonthly')).toBe('monthly');
  });

  it('Premium için haftalık ürün tanımı yok', () => {
    expect(Object.keys(SUBSCRIPTION_PRODUCT_MAP).filter((k) => /premium.*weekly|weekly.*premium/i.test(k))).toEqual([]);
  });
});

describe('haftalık Plus hakları', () => {
  it('haftalık abone Plus ile aynı limitleri alır; plan + dönem + dönem bonusu yanıtta', async () => {
    const { webhookService, subscriptionService } = await setup();
    await webhookService.handleRevenueCatEvent(event());
    const weekly = await subscriptionService.getDailyStats('u1');

    const { subscriptionService: svc2 } = await setup({
      users: [{
        id: 'u1', green_diamonds: 0, purple_diamonds: 0, subscription_plan: 'plus', subscription_period: 'monthly',
        subscription_expires_at: new Date(MONTH_END).toISOString(), daily_swipes_used: 0, daily_undos_used: 0,
        daily_swipes_reset_at: NOW.toISOString(),
      }],
    });
    const monthly = await svc2.getDailyStats('u1');

    expect(weekly).toMatchObject({
      dailyDiscoversLimit: -1, hasAds: false, dailyUndosLimit: 3, plan: 'plus', period: 'weekly', periodPurpleBonus: 100,
    });
    expect({ ...weekly, period: 0, periodPurpleBonus: 0 }).toEqual({ ...monthly, period: 0, periodPurpleBonus: 0 });
    expect(monthly).toMatchObject({ plan: 'plus', period: 'monthly', periodPurpleBonus: 500, monthlyPurpleBonus: 500 });
  });

  it('getStatus dönem döner; dönem kaydı olmayan eski abonelik monthly', async () => {
    const { webhookService, subscriptionService } = await setup();
    await webhookService.handleRevenueCatEvent(event());
    await expect(subscriptionService.getStatus('u1')).resolves.toMatchObject({ plan: 'plus', period: 'weekly', isActive: true });

    const old = await setup({
      users: [{ id: 'u1', subscription_plan: 'plus', subscription_expires_at: new Date(MONTH_END).toISOString() }],
    });
    await expect(old.subscriptionService.getStatus('u1')).resolves.toMatchObject({ plan: 'plus', period: 'monthly' });
  });

  it('EXPIRATION sonrası ücretsiz limitlere döner, dönem temizlenir', async () => {
    const { fake, webhookService, subscriptionService } = await setup();
    await webhookService.handleRevenueCatEvent(event());
    await webhookService.handleRevenueCatEvent(event({ type: 'EXPIRATION', transaction_id: 'tx-w1-exp' }));

    expect(user(fake)).toMatchObject({ subscription_plan: null, subscription_period: null, subscription_expires_at: null });
    await expect(subscriptionService.getDailyStats('u1')).resolves.toMatchObject({
      plan: 'free', period: null, dailyDiscoversLimit: 25, hasAds: true,
    });
  });
});

describe('haftalık dönem bonusu (100) ve idempotency', () => {
  it('INITIAL_PURCHASE 100 mor, dönem anahtarı haftalık önekli', async () => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent(event());

    expect(user(fake)).toMatchObject({ subscription_plan: 'plus', subscription_period: 'weekly', purple_diamonds: 100 });
    expect(bonuses(fake)).toHaveLength(1);
    expect(bonuses(fake)[0]).toMatchObject({ amount: 100, reference_id: `sub_plus_weekly_${new Date(T1).toISOString()}` });
  });

  it('her RENEWAL yeni dönem için 100 yatırır (3 dönem = 300)', async () => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent(event());
    await webhookService.handleRevenueCatEvent(event({ type: 'RENEWAL', transaction_id: 'tx-w2', expiration_at_ms: T2 }));
    await webhookService.handleRevenueCatEvent(event({ type: 'RENEWAL', transaction_id: 'tx-w3', expiration_at_ms: T2 + WEEK }));

    expect(bonuses(fake).map((r) => r.amount)).toEqual([100, 100, 100]);
    expect(user(fake).purple_diamonds).toBe(300);
    expect(user(fake).subscription_expires_at).toBe(new Date(T2 + WEEK).toISOString());
  });

  it('aynı olay tekrar gelirse (RevenueCat retry) ikinci bonus yok', async () => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent(event({ type: 'RENEWAL', transaction_id: 'tx-w2', expiration_at_ms: T2 }));
    await webhookService.handleRevenueCatEvent(event({ type: 'RENEWAL', transaction_id: 'tx-w2', expiration_at_ms: T2 }));
    expect(bonuses(fake)).toHaveLength(1);
    expect(user(fake).purple_diamonds).toBe(100);
  });

  it('farklı işlem numarası ama aynı dönem (istemci activate + webhook): tek bonus', async () => {
    const { fake, webhookService, subscriptionService } = await setup();
    await subscriptionService.activateFromClient(
      'u1', 'plus', 'client_u1', 'quloplusweekly', new Date(T1).toISOString().replace('.000Z', 'Z'),
      { paidEligible: false, sandbox: false }, 'weekly',
    );
    await webhookService.handleRevenueCatEvent(event());
    expect(bonuses(fake)).toHaveLength(1);
    expect(user(fake).purple_diamonds).toBe(100);
  });

  it('aylık bonus değişmedi: 500, anahtar eski biçimde (haftalık önek yok)', async () => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent(event({ product_id: MONTHLY, expiration_at_ms: MONTH_END, transaction_id: 'tx-m1' }));

    expect(user(fake)).toMatchObject({ subscription_plan: 'plus', subscription_period: 'monthly', purple_diamonds: 500 });
    expect(bonuses(fake)[0]).toMatchObject({ amount: 500, reference_id: `sub_plus_${new Date(MONTH_END).toISOString()}` });
  });

  it('aynı bitiş anına denk gelen haftalık ve aylık dönem birbirini ezmez (anahtarlar ayrı)', async () => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent(event({ expiration_at_ms: T1 }));
    await webhookService.handleRevenueCatEvent(event({ product_id: MONTHLY, expiration_at_ms: T1, transaction_id: 'tx-m1' }));
    expect(bonuses(fake).map((r) => r.amount).sort((a, b) => a - b)).toEqual([100, 500]);
  });
});

describe('geçişler: çift bonus yok, hak kesintisi yok', () => {
  const stillAccess = (fake: Fake) => {
    expect(user(fake).subscription_plan).not.toBeNull();
    expect(new Date(user(fake).subscription_expires_at as string).getTime()).toBeGreaterThan(NOW.getTime());
  };

  it('haftalık → aylık: PRODUCT_CHANGE bonus vermez; yeni ürünün satın alması 500 (toplam 600)', async () => {
    const { fake, webhookService } = await setup();
    store = { plan: 'plus', period: 'weekly', expiresAt: new Date(T1).toISOString() };
    await webhookService.handleRevenueCatEvent(event());

    // Eski (haftalık) ürünle gelen PRODUCT_CHANGE: no-op, erişim mağaza durumundan.
    await webhookService.handleRevenueCatEvent(event({ type: 'PRODUCT_CHANGE', transaction_id: 'tx-w1', expiration_at_ms: NOW.getTime() + 1000 }));
    expect(bonuses(fake)).toHaveLength(1);
    stillAccess(fake);

    store = { plan: 'plus', period: 'monthly', expiresAt: new Date(MONTH_END).toISOString() };
    await webhookService.handleRevenueCatEvent(event({ type: 'RENEWAL', product_id: MONTHLY, transaction_id: 'tx-m1', expiration_at_ms: MONTH_END }));
    await webhookService.handleRevenueCatEvent(event({ type: 'RENEWAL', product_id: MONTHLY, transaction_id: 'tx-m1', expiration_at_ms: MONTH_END }));

    expect(bonuses(fake).map((r) => r.amount)).toEqual([100, 500]);
    expect(user(fake)).toMatchObject({ subscription_period: 'monthly', purple_diamonds: 600 });
    stillAccess(fake);
  });

  it('aylık → haftalık: PRODUCT_CHANGE bonus vermez; haftalık yenileme 100 (toplam 600)', async () => {
    const { fake, webhookService } = await setup();
    store = { plan: 'plus', period: 'monthly', expiresAt: new Date(MONTH_END).toISOString() };
    await webhookService.handleRevenueCatEvent(event({ product_id: MONTHLY, expiration_at_ms: MONTH_END, transaction_id: 'tx-m1' }));

    await webhookService.handleRevenueCatEvent(event({ type: 'PRODUCT_CHANGE', product_id: MONTHLY, transaction_id: 'tx-m1', expiration_at_ms: MONTH_END }));
    expect(bonuses(fake)).toHaveLength(1);
    stillAccess(fake);

    store = { plan: 'plus', period: 'weekly', expiresAt: new Date(MONTH_END + WEEK).toISOString() };
    await webhookService.handleRevenueCatEvent(event({ type: 'RENEWAL', transaction_id: 'tx-w1', expiration_at_ms: MONTH_END + WEEK }));

    expect(bonuses(fake).map((r) => r.amount)).toEqual([500, 100]);
    expect(user(fake)).toMatchObject({ subscription_period: 'weekly', purple_diamonds: 600 });
    stillAccess(fake);
  });

  it('haftalık → Premium aylık: PRODUCT_CHANGE bonus vermez; premium dönemi 1000, erişim premium', async () => {
    const { fake, webhookService } = await setup();
    store = { plan: 'plus', period: 'weekly', expiresAt: new Date(T1).toISOString() };
    await webhookService.handleRevenueCatEvent(event());

    await webhookService.handleRevenueCatEvent(event({ type: 'PRODUCT_CHANGE', transaction_id: 'tx-w1', expiration_at_ms: NOW.getTime() + 60_000 }));
    expect(bonuses(fake)).toHaveLength(1);

    store = { plan: 'premium', period: 'monthly', expiresAt: new Date(MONTH_END).toISOString() };
    await webhookService.handleRevenueCatEvent(event({ type: 'RENEWAL', product_id: PREMIUM, transaction_id: 'tx-p1', expiration_at_ms: MONTH_END }));
    // Google yolu: eski haftalık ürünün EXPIRATION'ı gelse de mağazada premium aktif → erişim sürer.
    await webhookService.handleRevenueCatEvent(event({ type: 'EXPIRATION', transaction_id: 'tx-w1-exp', expiration_at_ms: NOW.getTime() + 60_000 }));

    expect(bonuses(fake).map((r) => r.amount)).toEqual([100, 1000]);
    expect(user(fake)).toMatchObject({ subscription_plan: 'premium', subscription_period: 'monthly' });
    stillAccess(fake);
  });
});

describe('config geriye uyumu ve bilinmeyen ürün', () => {
  it('subscriptionBonuses olmayan eski config parse edilir, varsayılan haftalık 100', () => {
    const { subscriptionBonuses: _drop, ...old } = economyConfigFixture;
    expect(economyConfigSchema.parse(old).subscriptionBonuses).toEqual({ weekly: { plus: 100 } });
    expect(economyConfigSchema.parse({ ...old, subscriptionBonuses: {} }).subscriptionBonuses.weekly.plus).toBe(100);
  });

  it('eski config satırıyla (alan yok) haftalık bonus yine 100 yatar', async () => {
    const { subscriptionBonuses: _drop, ...old } = configRow().config as Record<string, unknown>;
    const { fake, webhookService } = await setup({}, old);
    await webhookService.handleRevenueCatEvent(event());
    expect(user(fake).purple_diamonds).toBe(100);
  });

  it('admin config ile haftalık bonus değiştirilebilir; sınır dışı reddedilir', () => {
    expect(economyConfigSchema.parse({ ...economyConfigFixture, subscriptionBonuses: { weekly: { plus: 150 } } })
      .subscriptionBonuses.weekly.plus).toBe(150);
    expect(() => economyConfigSchema.parse({ ...economyConfigFixture, subscriptionBonuses: { weekly: { plus: 5000 } } })).toThrow();
  });

  it('bilinmeyen abonelik ürün kimliği loglanır, hiçbir şey yazılmaz', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent(event({ product_id: 'quloplusdaily' }));

    expect(warn).toHaveBeenCalledWith('[webhook] unknown subscription product ignored', expect.objectContaining({ productId: 'quloplusdaily' }));
    expect(user(fake)).toMatchObject({ subscription_plan: null, purple_diamonds: 0 });
    expect(bonuses(fake)).toHaveLength(0);
    expect(fake.table('iap_transactions')).toHaveLength(0);
  });
});
