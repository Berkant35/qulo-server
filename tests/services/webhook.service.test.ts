import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';

/**
 * RevenueCat webhook'u — store'dan gelen olayı elmasa/aboneliğe çeviren yer.
 * Webhook'lar tekrar gönderilebilir (RevenueCat retry yapar), o yüzden
 * idempotency burada para güvenliğinin kendisi.
 *
 * Gerçek subscriptionService ve diamondService kullanılıyor — mock'lanmıyor ki
 * zincirin tamamı (bonus yatırma, duplicate guard) sahiden test edilsin.
 */
async function setup(seed: Tables = {}) {
  const fake = createFakeSupabase({
    economy_config_versions: [activeConfigRow()],
    users: [{
      id: 'u1', green_diamonds: 0, purple_diamonds: 0,
      subscription_plan: null, subscription_expires_at: null, rc_customer_id: null,
    }],
    ...seed,
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { webhookService } = await import('../../src/services/webhook.service.js');
  return { fake, webhookService };
}

const NOW = new Date('2026-09-01T12:00:00Z');
const EXPIRES_MS = new Date('2026-10-01T12:00:00Z').getTime();

const event = (over: Record<string, unknown> = {}) => ({
  type: 'INITIAL_PURCHASE',
  app_user_id: 'u1',
  product_id: 'quloplusmonthly2',
  store: 'APP_STORE',
  expiration_at_ms: EXPIRES_MS,
  transaction_id: 'tx-1',
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

describe('tüketilebilir satın alma (NON_RENEWING_PURCHASE)', () => {
  it('ürün haritasındaki kadar mor elmas yatırır', async () => {
    const { fake, webhookService } = await setup();

    await webhookService.handleRevenueCatEvent(event({
      type: 'NON_RENEWING_PURCHASE', product_id: 'qulopurple400', transaction_id: 'tx-buy',
    }));

    expect(fake.table('users')[0].purple_diamonds).toBe(400);
    expect(fake.table('iap_transactions')[0]).toMatchObject({
      user_id: 'u1', product_id: 'qulopurple400', transaction_id: 'tx-buy',
      purple_credited: 400, rc_event_type: 'NON_RENEWING_PURCHASE',
    });
  });

  /** RevenueCat aynı webhook'u tekrar gönderirse elmas iki kez yatmamalı. */
  it('aynı transaction ikinci kez işlenmez', async () => {
    const { fake, webhookService } = await setup();
    const buy = event({
      type: 'NON_RENEWING_PURCHASE', product_id: 'qulopurple400', transaction_id: 'tx-buy',
    });

    await webhookService.handleRevenueCatEvent(buy);
    await webhookService.handleRevenueCatEvent(buy);

    expect(fake.table('users')[0].purple_diamonds).toBe(400);
    expect(fake.table('iap_transactions')).toHaveLength(1);
  });

  it('bilinmeyen ürün için elmas yatırmaz', async () => {
    const { fake, webhookService } = await setup();

    await webhookService.handleRevenueCatEvent(event({
      type: 'NON_RENEWING_PURCHASE', product_id: 'olmayan_urun', transaction_id: 'tx-x',
    }));

    expect(fake.table('users')[0].purple_diamonds).toBe(0);
    expect(fake.table('iap_transactions')).toHaveLength(0);
  });

  it('store alanına göre apple/google ayrımı yapar', async () => {
    const { fake, webhookService } = await setup();

    await webhookService.handleRevenueCatEvent(event({
      type: 'NON_RENEWING_PURCHASE', product_id: 'qulopurple50',
      transaction_id: 'tx-a', store: 'APP_STORE',
    }));
    await webhookService.handleRevenueCatEvent(event({
      type: 'NON_RENEWING_PURCHASE', product_id: 'qulopurple50',
      transaction_id: 'tx-g', store: 'PLAY_STORE',
    }));

    const rows = fake.table('iap_transactions');
    expect(rows.find((r) => r.transaction_id === 'tx-a')!.store).toBe('apple');
    expect(rows.find((r) => r.transaction_id === 'tx-g')!.store).toBe('google');
  });

  it('her paket boyutu doğru tutarı yatırır', async () => {
    const cases: Array<[string, number]> = [
      ['qulopurple50', 50], ['qulopurple150', 150], ['qulopurple1000', 1000],
      ['qulopurple6000', 6000],
    ];

    for (const [productId, amount] of cases) {
      vi.resetModules();
      const { fake, webhookService } = await setup();
      await webhookService.handleRevenueCatEvent(event({
        type: 'NON_RENEWING_PURCHASE', product_id: productId, transaction_id: `tx-${productId}`,
      }));
      expect(fake.table('users')[0].purple_diamonds, productId).toBe(amount);
    }
  });
});

describe('abonelik olayları', () => {
  it('INITIAL_PURCHASE aboneliği aktive eder ve bonusu yatırır', async () => {
    const { fake, webhookService } = await setup();

    await webhookService.handleRevenueCatEvent(event());

    expect(fake.table('users')[0]).toMatchObject({
      subscription_plan: 'plus', purple_diamonds: 200,
    });
    expect(fake.table('iap_transactions')[0].rc_event_type).toBe('INITIAL_PURCHASE');
  });

  it('premium ürün premium plana çevrilir', async () => {
    const { fake, webhookService } = await setup();

    await webhookService.handleRevenueCatEvent(event({ product_id: 'qulopremiummonthly2' }));

    expect(fake.table('users')[0]).toMatchObject({
      subscription_plan: 'premium', purple_diamonds: 1000,
    });
  });

  it('RENEWAL süreyi uzatır', async () => {
    const { fake, webhookService } = await setup({
      users: [{
        id: 'u1', purple_diamonds: 0, green_diamonds: 0,
        subscription_plan: 'plus', subscription_expires_at: '2026-08-01T00:00:00Z',
      }],
      user_subscriptions: [{ id: 's1', user_id: 'u1', plan: 'plus', status: 'active' }],
    });

    await webhookService.handleRevenueCatEvent(event({ type: 'RENEWAL', transaction_id: 'tx-r' }));

    expect(fake.table('users')[0].subscription_expires_at)
      .toBe(new Date(EXPIRES_MS).toISOString());
  });

  it('CANCELLATION kaydı iptal eder ama erişimi kesmez', async () => {
    const { fake, webhookService } = await setup({
      users: [{
        id: 'u1', purple_diamonds: 0, green_diamonds: 0,
        subscription_plan: 'plus', subscription_expires_at: '2026-10-01T00:00:00Z',
      }],
      user_subscriptions: [{ id: 's1', user_id: 'u1', status: 'active' }],
    });

    await webhookService.handleRevenueCatEvent(event({ type: 'CANCELLATION', transaction_id: 'tx-c' }));

    expect(fake.table('user_subscriptions')[0].status).toBe('cancelled');
    expect(fake.table('users')[0].subscription_plan).toBe('plus');
  });

  it('EXPIRATION planı temizler', async () => {
    const { fake, webhookService } = await setup({
      users: [{
        id: 'u1', purple_diamonds: 0, green_diamonds: 0,
        subscription_plan: 'premium', subscription_expires_at: '2026-08-01T00:00:00Z',
      }],
      user_subscriptions: [{ id: 's1', user_id: 'u1', status: 'active' }],
    });

    await webhookService.handleRevenueCatEvent(event({ type: 'EXPIRATION', transaction_id: 'tx-e' }));

    expect(fake.table('users')[0].subscription_plan).toBeNull();
    expect(fake.table('user_subscriptions')[0].status).toBe('expired');
  });

  it('PRODUCT_CHANGE yeni plana geçirir', async () => {
    const { fake, webhookService } = await setup({
      users: [{
        id: 'u1', purple_diamonds: 0, green_diamonds: 0,
        subscription_plan: 'plus', subscription_expires_at: '2026-10-01T00:00:00Z',
        rc_customer_id: 'rc-9',
      }],
      user_subscriptions: [{ id: 's1', user_id: 'u1', plan: 'plus', status: 'active' }],
    });

    await webhookService.handleRevenueCatEvent(event({
      type: 'PRODUCT_CHANGE', product_id: 'qulopremiummonthly2', transaction_id: 'tx-pc',
    }));

    expect(fake.table('users')[0]).toMatchObject({
      subscription_plan: 'premium', rc_customer_id: 'rc-9',
    });
  });

  it('UNCANCELLATION aboneliği yeniden aktifleştirir', async () => {
    const { fake, webhookService } = await setup({
      users: [{
        id: 'u1', purple_diamonds: 0, green_diamonds: 0,
        subscription_plan: 'plus', subscription_expires_at: '2026-09-15T00:00:00Z',
      }],
      user_subscriptions: [{ id: 's1', user_id: 'u1', status: 'active' }],
    });

    await webhookService.handleRevenueCatEvent(event({ type: 'UNCANCELLATION', transaction_id: 'tx-u' }));

    expect(fake.table('user_subscriptions')[0].status).toBe('active');
  });
});

describe('idempotency ve dayanıklılık', () => {
  /** (transaction_id, event_type) çifti başına tek kez — RevenueCat retry'ına karşı. */
  it('aynı transaction + event tipi ikinci kez işlenmez', async () => {
    const { fake, webhookService } = await setup();

    await webhookService.handleRevenueCatEvent(event());
    await webhookService.handleRevenueCatEvent(event());

    expect(fake.table('users')[0].purple_diamonds).toBe(200);
    expect(fake.table('user_subscriptions')).toHaveLength(1);
  });

  it('aynı transaction farklı event tipiyle işlenir (satın alma sonrası iptal)', async () => {
    const { fake, webhookService } = await setup();

    await webhookService.handleRevenueCatEvent(event({ type: 'INITIAL_PURCHASE' }));
    await webhookService.handleRevenueCatEvent(event({ type: 'CANCELLATION' }));

    expect(fake.table('user_subscriptions')[0].status).toBe('cancelled');
  });

  it('bilinmeyen ürün için abonelik işlemi yapmaz', async () => {
    const { fake, webhookService } = await setup();

    await webhookService.handleRevenueCatEvent(event({ product_id: 'olmayan_abonelik' }));

    expect(fake.table('users')[0].subscription_plan).toBeNull();
    expect(fake.table('iap_transactions')).toHaveLength(0);
  });

  /** Bozuk payload sessizce yutulmalı — 500 dönmek RevenueCat'i sonsuz retry'a sokar. */
  it('expiration_at_ms eksikse hata atmaz, işlem yapmaz', async () => {
    const { fake, webhookService } = await setup();

    await expect(
      webhookService.handleRevenueCatEvent(event({ expiration_at_ms: undefined })),
    ).resolves.toBeUndefined();

    expect(fake.table('users')[0].subscription_plan).toBeNull();
  });

  it('bilinmeyen event tipi hata atmaz ve abonelik durumunu değiştirmez', async () => {
    const { fake, webhookService } = await setup();

    await expect(
      webhookService.handleRevenueCatEvent(event({ type: 'BILLING_ISSUE' })),
    ).resolves.toBeUndefined();

    expect(fake.table('users')[0].subscription_plan).toBeNull();
    // Bilinmeyen tip de kaydediliyor — denetim izi için.
    expect(fake.table('iap_transactions')[0].rc_event_type).toBe('BILLING_ISSUE');
  });

  it('transaction_id olmayan olay hata atmaz', async () => {
    const { webhookService } = await setup();
    await expect(
      webhookService.handleRevenueCatEvent(event({ transaction_id: undefined })),
    ).resolves.toBeUndefined();
  });

  it('başka kullanıcının bakiyesine dokunmaz', async () => {
    const { fake, webhookService } = await setup({
      users: [
        { id: 'u1', green_diamonds: 0, purple_diamonds: 0, subscription_plan: null, subscription_expires_at: null },
        { id: 'u2', green_diamonds: 0, purple_diamonds: 77, subscription_plan: null, subscription_expires_at: null },
      ],
    });

    await webhookService.handleRevenueCatEvent(event({
      type: 'NON_RENEWING_PURCHASE', product_id: 'qulopurple50', transaction_id: 'tx-1',
    }));

    expect(fake.table('users').find((r) => r.id === 'u2')!.purple_diamonds).toBe(77);
  });
});
