import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';
import type { RevenueCatTransferEvent } from '../../src/services/webhook.service.js';

/**
 * RevenueCat webhook'u — store'dan gelen olayı elmasa/aboneliğe çeviren yer.
 * Webhook'lar tekrar gönderilebilir (RevenueCat retry yapar), o yüzden
 * idempotency burada para güvenliğinin kendisi.
 *
 * Gerçek subscriptionService ve diamondService kullanılıyor — mock'lanmıyor ki
 * zincirin tamamı (bonus yatırma, duplicate guard) sahiden test edilsin.
 */
async function setup(seed: Tables = {}, options: FakeSupabaseOptions = {}) {
  const fake = createFakeSupabase(
    {
      economy_config_versions: [activeConfigRow()],
      users: [{
        id: 'u1', green_diamonds: 0, purple_diamonds: 0,
        subscription_plan: null, subscription_expires_at: null, rc_customer_id: null,
      }],
      ...seed,
    },
    options,
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  vi.doMock('../../src/services/revenuecat.service.js', () => ({ revenueCatService: storeMock }));
  const { webhookService } = await import('../../src/services/webhook.service.js');
  return { fake, webhookService };
}

/**
 * RevenueCat GET /subscribers — webhook sonrası erişimin doğrusu. `'off'` = senkron yok (yerel,
 * anahtarsız): erişim olay alanlarından. `'throw'` = API hatası. Varsayılan `'off'`.
 * `storeByUser` kullanıcı başına durum (TRANSFER iki hesabı birlikte okur; `'throw'` = o kullanıcının
 * okuması patlar); verilmeyen kullanıcı `store`'a düşer. `storeReads` = okunan kullanıcılar.
 */
type StoreState = { plan: 'plus' | 'premium'; expiresAt: string };
let store: StoreState | null | 'off' | 'throw' = 'off';
let storeByUser: Record<string, StoreState | null | 'throw'> = {};
let storeReads: string[] = [];
const storeMock = {
  canSyncSubscriptions: () => store !== 'off',
  getActiveSubscription: async (userId: string) => {
    storeReads.push(userId);
    if (store === 'throw') throw new Error('RevenueCat API error: 500');
    if (userId in storeByUser) {
      const own = storeByUser[userId];
      if (own === 'throw') throw new Error('RevenueCat API error: 500');
      return own;
    }
    return store === 'off' ? null : store;
  },
};
beforeEach(() => { store = 'off'; storeByUser = {}; storeReads = []; });

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

/**
 * Tüketilebilir webhook kredisi `RC_CONSUMABLE_WEBHOOK_CREDIT` ile kapılı (varsayılan KAPALI =
 * doğrulama modu): webhook `transaction_id`'sinin istemci yolunun referansıyla aynı olduğu iOS ve
 * Android'de doğrulanana kadar webhook mor yatırmaz. `''` = tanımsız (dotenv mevcut anahtarı ezmez).
 */
let oncekiKredi: string | undefined;
beforeEach(() => { oncekiKredi = process.env.RC_CONSUMABLE_WEBHOOK_CREDIT; });
afterEach(() => {
  if (oncekiKredi === undefined) delete process.env.RC_CONSUMABLE_WEBHOOK_CREDIT;
  else process.env.RC_CONSUMABLE_WEBHOOK_CREDIT = oncekiKredi;
  vi.restoreAllMocks();
});

describe('tüketilebilir webhook kredisi kapısı (RC_CONSUMABLE_WEBHOOK_CREDIT)', () => {
  it.each(['', 'false'])('bayrak %j: mor yatmaz, iz satırı purple_credited 0 ile yazılır, uyarı loglanır', async (flag) => {
    process.env.RC_CONSUMABLE_WEBHOOK_CREDIT = flag;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fake, webhookService } = await setup();

    await webhookService.handleRevenueCatEvent(event({
      type: 'NON_RENEWING_PURCHASE', product_id: 'qulopurple400', transaction_id: 'tx-buy', environment: 'PRODUCTION',
    }));

    expect(fake.table('users')[0].purple_diamonds).toBe(0);
    expect(fake.table('diamond_transactions')).toHaveLength(0);
    expect(fake.table('iap_transactions')).toEqual([
      expect.objectContaining({
        user_id: 'u1', product_id: 'qulopurple400', transaction_id: 'tx-buy',
        rc_event_type: 'NON_RENEWING_PURCHASE', purple_credited: 0,
      }),
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      '[webhook] consumable credit disabled (verification mode)',
      expect.objectContaining({ userId: 'u1', productId: 'qulopurple400', transactionId: 'tx-buy' }),
    );
  });

  it.each(['', 'true'])('bayrak %j: transaction_id yoksa asla kredi yok (tekilleştirme imkânsız), iz yok, hata loglanır', async (flag) => {
    process.env.RC_CONSUMABLE_WEBHOOK_CREDIT = flag;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fake, webhookService } = await setup();

    await expect(webhookService.handleRevenueCatEvent(event({
      type: 'NON_RENEWING_PURCHASE', product_id: 'qulopurple400', transaction_id: undefined,
    }))).resolves.toBeUndefined();

    expect(fake.table('users')[0].purple_diamonds).toBe(0);
    expect(fake.table('diamond_transactions')).toHaveLength(0);
    expect(fake.table('iap_transactions')).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('tüketilebilir satın alma (NON_RENEWING_PURCHASE)', () => {
  // Kredi yolu: bayrak açık (üretimde doğrulamadan sonra açılır).
  beforeEach(() => { process.env.RC_CONSUMABLE_WEBHOOK_CREDIT = 'true'; });

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

  it('istemci yolu aynı satın almayı zaten kredilediyse: ikinci kredi yok, log purple_credited 0', async () => {
    const { fake, webhookService } = await setup({
      diamond_transactions: [
        { id: 'd1', user_id: 'u1', type: 'PURPLE', amount: 50, paid_amount: 50, reason: 'IAP_PURCHASE', reference_id: 'tx-client', created_at: '2026-09-01T11:00:00Z' },
      ],
      iap_transactions: [],
    });

    await webhookService.handleRevenueCatEvent(
      event({ type: 'NON_RENEWING_PURCHASE', product_id: 'qulopurple50', transaction_id: 'tx-client', expiration_at_ms: null }),
    );

    expect(fake.table('users')[0].purple_diamonds).toBe(0);
    expect(fake.table('iap_transactions')).toEqual([
      expect.objectContaining({ transaction_id: 'tx-client', rc_event_type: 'NON_RENEWING_PURCHASE', purple_credited: 0 }),
    ]);
  });

  it('idempotency okuma hatası: hata yükselir, kredi verilmez (RevenueCat yeniden dener)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fake, webhookService } = await setup({}, { failOn: [{ table: 'iap_transactions', op: 'select' }] });

    await expect(
      webhookService.handleRevenueCatEvent(event({
        type: 'NON_RENEWING_PURCHASE', product_id: 'qulopurple50', transaction_id: 'tx-read-err',
      })),
    ).rejects.toMatchObject({ code: 'SERVER_ERROR' });

    expect(fake.table('users')[0].purple_diamonds).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[webhook]'),
      expect.objectContaining({ eventType: 'NON_RENEWING_PURCHASE', transactionId: 'tx-read-err', error: expect.any(String) }),
    );
  });

  it('log upsert hatası: kredi yatar ama hata yükselir (log yazılamadı); ikinci teslimatta (arıza çözülmüş) kredi tekrar verilmez, log satırı yazılır', async () => {
    const buy = event({
      type: 'NON_RENEWING_PURCHASE', product_id: 'qulopurple50', transaction_id: 'tx-log-err',
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fake, webhookService } = await setup({}, { failOn: [{ table: 'iap_transactions', op: 'insert' }] });
    await expect(webhookService.handleRevenueCatEvent(buy)).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(fake.table('users')[0].purple_diamonds).toBe(50);
    expect(fake.table('iap_transactions')).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[webhook]'),
      expect.objectContaining({ eventType: 'NON_RENEWING_PURCHASE', transactionId: 'tx-log-err', error: expect.any(String) }),
    );

    // RevenueCat aynı webhook'u tekrar gönderir; bu sefer arıza yok (fake without the failure).
    vi.resetModules();
    const { fake: fake2, webhookService: webhookService2 } = await setup({
      users: fake.table('users'),
      diamond_transactions: fake.table('diamond_transactions'),
      iap_transactions: fake.table('iap_transactions'),
    });
    await webhookService2.handleRevenueCatEvent(buy);

    expect(fake2.table('users')[0].purple_diamonds).toBe(50);
    expect(fake2.table('iap_transactions')).toHaveLength(1);
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
      user_subscriptions: [{ id: 's1', user_id: 'u1', plan: 'premium', status: 'active' }],
    });

    await webhookService.handleRevenueCatEvent(event({ type: 'EXPIRATION', product_id: 'qulopremiummonthly2', transaction_id: 'tx-e' }));

    expect(fake.table('users')[0].subscription_plan).toBeNull();
    expect(fake.table('user_subscriptions')[0].status).toBe('expired');
  });

  it('RENEWAL planı olayın ürününden alır (yükseltmede yeni ürünle gelir)', async () => {
    const { fake, webhookService } = await setup({
      users: [{
        id: 'u1', purple_diamonds: 0, green_diamonds: 0,
        subscription_plan: 'plus', subscription_expires_at: '2026-08-01T00:00:00Z',
      }],
      user_subscriptions: [{ id: 's1', user_id: 'u1', plan: 'plus', status: 'active' }],
    });

    await webhookService.handleRevenueCatEvent(event({
      type: 'RENEWAL', product_id: 'qulopremiummonthly2', transaction_id: 'tx-r',
    }));

    expect(fake.table('users')[0]).toMatchObject({ subscription_plan: 'premium', purple_diamonds: 1000 });
    expect(fake.table('user_subscriptions')[0]).toMatchObject({ plan: 'premium', status: 'active' });
  });

  // Google yükseltmesi: eski ürünün EXPIRATION'ı gelir ama mağazada premium aktif.
  it('EXPIRATION eski ürün için gelse de mağazada aktif üst plan varsa erişim sürer', async () => {
    store = { plan: 'premium', expiresAt: '2026-10-01T12:00:00.000Z' };
    const { fake, webhookService } = await setup({
      users: [{
        id: 'u1', purple_diamonds: 0, green_diamonds: 0,
        subscription_plan: 'premium', subscription_expires_at: '2026-10-01T12:00:00.000Z',
      }],
      user_subscriptions: [
        { id: 's0', user_id: 'u1', plan: 'plus', status: 'active' },
        { id: 's1', user_id: 'u1', plan: 'premium', status: 'active' },
      ],
    });

    await webhookService.handleRevenueCatEvent(event({
      type: 'EXPIRATION', product_id: 'quloplusmonthly2', transaction_id: 'tx-old',
      expiration_at_ms: NOW.getTime(),
    }));

    expect(fake.table('users')[0]).toMatchObject({
      subscription_plan: 'premium', subscription_expires_at: '2026-10-01T12:00:00.000Z',
    });
    const rows = fake.table('user_subscriptions');
    expect(rows.find((r) => r.id === 's0')!.status).toBe('expired');
    expect(rows.find((r) => r.id === 's1')!.status).toBe('active');
  });

  it('UNCANCELLATION iptal edilmiş güncel satırı yeniden aktifleştirir, bonus vermez', async () => {
    const { fake, webhookService } = await setup({
      users: [{
        id: 'u1', purple_diamonds: 0, green_diamonds: 0,
        subscription_plan: 'plus', subscription_expires_at: '2026-09-15T00:00:00Z',
      }],
      user_subscriptions: [
        { id: 's1', user_id: 'u1', plan: 'plus', status: 'cancelled', expires_at: '2026-09-15T00:00:00Z' },
        { id: 's0', user_id: 'u1', plan: 'plus', status: 'cancelled', expires_at: '2026-08-15T00:00:00Z' },
      ],
    });

    await webhookService.handleRevenueCatEvent(event({ type: 'UNCANCELLATION', transaction_id: 'tx-u' }));

    const rows = fake.table('user_subscriptions');
    expect(rows.find((r) => r.id === 's1')!.status).toBe('active');
    expect(rows.find((r) => r.id === 's0')!.status).toBe('cancelled');
    expect(fake.table('users')[0].purple_diamonds).toBe(0);
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  // İade aboneliği hemen bitirir: EXPIRATION'ın bitişi iade anı, kayıtlı bitiş hâlâ dönem sonu.
  it('iade EXPIRATION\'ı (aynı plan, dönem sonundan önce) erişimi keser', async () => {
    store = null;
    const { fake, webhookService } = await setup({
      users: [{
        id: 'u1', purple_diamonds: 0, green_diamonds: 0,
        subscription_plan: 'plus', subscription_expires_at: '2026-10-01T12:00:00Z',
      }],
      user_subscriptions: [{ id: 's1', user_id: 'u1', plan: 'plus', status: 'active' }],
    });

    await webhookService.handleRevenueCatEvent(event({
      type: 'EXPIRATION', transaction_id: 'tx-refund', expiration_at_ms: NOW.getTime(),
    }));

    expect(fake.table('users')[0]).toMatchObject({ subscription_plan: null, subscription_expires_at: null });
    expect(fake.table('user_subscriptions')[0].status).toBe('expired');
  });

  it('mağaza okuması patlarsa hiçbir şey yazılmaz, hata yükselir (RevenueCat yeniden dener)', async () => {
    store = 'throw';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fake, webhookService } = await setup({
      users: [{
        id: 'u1', purple_diamonds: 0, green_diamonds: 0,
        subscription_plan: 'premium', subscription_expires_at: '2026-10-01T12:00:00Z',
      }],
      user_subscriptions: [{ id: 's1', user_id: 'u1', plan: 'premium', status: 'active' }],
    });

    await expect(webhookService.handleRevenueCatEvent(event({
      type: 'EXPIRATION', product_id: 'qulopremiummonthly2', transaction_id: 'tx-e', expiration_at_ms: NOW.getTime(),
    }))).rejects.toThrow();

    expect(fake.table('users')[0].subscription_plan).toBe('premium');
    expect(fake.table('user_subscriptions')[0].status).toBe('active');
    expect(fake.table('iap_transactions')).toHaveLength(0);
  });
});

/**
 * TRANSFER (RevenueCat docs: event-types-and-fields): satın almalar ve haklar `transferred_from`'dan
 * `transferred_to`'ya geçti — aynı Apple/Google hesabıyla başka Qulo hesabına giriş / geri yükleme.
 * Olayda `app_user_id`/`product_id` YOK; webhook yalnız hedef için bir kez gelir. Eskiden şema 400'le
 * reddediyordu ve eski hesap dönem sonuna kadar premium kaldı (2026-11-12: tek abonelik, iki premium).
 */
describe('TRANSFER — abonelik başka hesaba taşındı', () => {
  const FROM = '11111111-1111-4111-8111-111111111111';
  const TO = '22222222-2222-4222-8222-222222222222';
  const PREMIUM = { plan: 'premium' as const, expiresAt: '2026-10-01T12:00:00.000Z' };
  const transfer = (over: Partial<RevenueCatTransferEvent> = {}): RevenueCatTransferEvent => ({
    type: 'TRANSFER', transferred_from: [FROM], transferred_to: [TO],
    store: 'APP_STORE', environment: 'PRODUCTION', ...over,
  });
  const seed = () => ({
    users: [
      { id: FROM, purple_diamonds: 0, green_diamonds: 0, subscription_plan: 'premium', subscription_expires_at: PREMIUM.expiresAt },
      { id: TO, purple_diamonds: 0, green_diamonds: 0, subscription_plan: null, subscription_expires_at: null },
    ],
    user_subscriptions: [
      { id: 's1', user_id: FROM, plan: 'premium', status: 'active', expires_at: PREMIUM.expiresAt },
      { id: 's0', user_id: FROM, plan: 'plus', status: 'cancelled', expires_at: '2026-09-15T12:00:00.000Z' },
    ],
  });
  const userRow = (fake: Awaited<ReturnType<typeof setup>>['fake'], id: string) =>
    fake.table('users').find((u) => u.id === id)!;

  it('eski hesabın erişimi kapanır ve satırları biter; yeni hesap erişimi mağazadan alır; bonus yok', async () => {
    store = null;
    storeByUser = { [FROM]: null, [TO]: PREMIUM };
    const { fake, webhookService } = await setup(seed());

    await webhookService.handleRevenueCatEvent(transfer());

    expect(userRow(fake, FROM)).toMatchObject({ subscription_plan: null, subscription_expires_at: null });
    expect(fake.table('user_subscriptions').map((r) => r.status)).toEqual(['expired', 'expired']);
    expect(userRow(fake, TO)).toMatchObject({
      subscription_plan: 'premium', subscription_expires_at: PREMIUM.expiresAt, purple_diamonds: 0,
    });
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it('eski hesabın kendi başka aboneliği sürüyorsa erişimi mağazadaki o aboneliğe göre kalır', async () => {
    const ownPlus = { plan: 'plus' as const, expiresAt: '2026-09-20T12:00:00.000Z' };
    storeByUser = { [FROM]: ownPlus, [TO]: PREMIUM };
    store = null;
    const { fake, webhookService } = await setup(seed());

    await webhookService.handleRevenueCatEvent(transfer());

    expect(userRow(fake, FROM)).toMatchObject({ subscription_plan: 'plus', subscription_expires_at: ownPlus.expiresAt });
  });

  it('RevenueCat anonim kimlikleri Qulo hesabı değildir — okunmaz, yazılmaz', async () => {
    store = null;
    storeByUser = { [TO]: PREMIUM };
    const { fake, webhookService } = await setup(seed());

    await webhookService.handleRevenueCatEvent(transfer({ transferred_from: ['$RCAnonymousID:8f2c'] }));

    expect(storeReads).toEqual([TO]);
    expect(userRow(fake, FROM).subscription_plan).toBe('premium');
    expect(userRow(fake, TO).subscription_plan).toBe('premium');
  });

  it('bir hesabın mağaza okuması patlarsa diğeri de yazılmaz, hata yükselir (RevenueCat yeniden dener)', async () => {
    storeByUser = { [FROM]: null, [TO]: 'throw' }; // eski hesabın okuması başarılı, yeninin patlıyor
    store = null;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fake, webhookService } = await setup(seed());

    await expect(webhookService.handleRevenueCatEvent(transfer())).rejects.toMatchObject({ statusCode: 500 });

    expect(userRow(fake, FROM).subscription_plan).toBe('premium');
    expect(userRow(fake, TO).subscription_plan).toBeNull();
    expect(fake.table('user_subscriptions').map((r) => r.status)).toEqual(['active', 'cancelled']);
  });

  it('eski hesabın erişim yazımı patlarsa 500 (RevenueCat yeniden dener), sessizce premium kalmaz', async () => {
    store = null;
    storeByUser = { [FROM]: null };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Yalnız eski hesap yazılır (hedef anonim → atlanır). İki users.update da patlar:
    // expireSubscription'ınki (loglanır, fırlatmaz) + applyStoreState'inki (fırlatır).
    const { fake, webhookService } = await setup(seed(), {
      failOn: [{ table: 'users', op: 'update', failAfter: 0, times: 2 }],
    });

    await expect(webhookService.handleRevenueCatEvent(transfer({ transferred_to: ['$RCAnonymousID:9a1'] })))
      .rejects.toMatchObject({ statusCode: 500 });

    expect(userRow(fake, FROM).subscription_plan).toBe('premium');
  });

  it('iki listede de geçen kimlik bir kez okunur; boş listeler no-op', async () => {
    store = null;
    storeByUser = { [TO]: PREMIUM };
    const { fake, webhookService } = await setup(seed());

    await webhookService.handleRevenueCatEvent(transfer({ transferred_from: [TO], transferred_to: [TO] }));
    expect(storeReads).toEqual([TO]);

    storeReads = [];
    await webhookService.handleRevenueCatEvent(transfer({ transferred_from: [], transferred_to: [] }));
    expect(storeReads).toEqual([]);
    expect(userRow(fake, FROM).subscription_plan).toBe('premium');
  });

  it('mağaza senkronu yoksa (yerel) dokunmaz, hata vermez', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fake, webhookService } = await setup(seed());

    await expect(webhookService.handleRevenueCatEvent(transfer())).resolves.toBeUndefined();

    expect(userRow(fake, FROM).subscription_plan).toBe('premium');
    expect(storeReads).toEqual([]);
  });
});

/**
 * 2026-11-12 olayının webhook ayağı: abonelik başka hesaba taşındıktan (RevenueCat TRANSFER) sonra
 * eski sahibin INITIAL_PURCHASE/RENEWAL'ı gelirse (gecikme, yeniden deneme) mağaza aboneliği artık o
 * hesapta göstermez — dönem açılmaz, bonus yatmaz; dönemi yeni sahip istemci yolundan almış olabilir.
 */
describe('taşınan abonelik — eski sahibe geciken olay', () => {
  const plainUser = (id: string, over: Record<string, unknown> = {}) => ({
    id, purple_diamonds: 0, green_diamonds: 0, subscription_plan: null, subscription_expires_at: null, ...over,
  });
  const bonusRows = (fake: Awaited<ReturnType<typeof setup>>['fake']) =>
    fake.table('diamond_transactions').filter((r) => r.reason === 'SUBSCRIPTION_BONUS');

  it('RENEWAL: mağazada abonelik yoksa dönem uzamaz, bonus yok, erişim kapanır, olay işlendi sayılır', async () => {
    store = null;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fake, webhookService } = await setup({
      users: [plainUser('u1', { subscription_plan: 'premium', subscription_expires_at: '2026-09-01T13:00:00Z' })],
      user_subscriptions: [{
        id: 's1', user_id: 'u1', plan: 'premium', status: 'active', expires_at: '2026-09-01T13:00:00Z',
      }],
    });

    await webhookService.handleRevenueCatEvent(event({
      type: 'RENEWAL', product_id: 'qulopremiummonthly2', transaction_id: 'tx-r',
    }));

    expect(bonusRows(fake)).toHaveLength(0);
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 0, subscription_plan: null });
    expect(fake.table('user_subscriptions')[0].expires_at).toBe('2026-09-01T13:00:00Z');
    expect(fake.table('iap_transactions')[0].rc_event_type).toBe('RENEWAL');
  });

  it('yeni sahip istemci yolundan önce aldıysa eski sahibin INITIAL_PURCHASE\'ı ikinci bonus yatırmaz', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fake, webhookService } = await setup({ users: [plainUser('u1'), plainUser('u2')] });
    const { subscriptionService } = await import('../../src/services/subscription.service.js');
    store = null; // u1 aboneliği artık tutmuyor (u2'ye taşındı)

    await subscriptionService.activateFromClient(
      'u2', 'premium', 'client_u2', 'tx-1', new Date(EXPIRES_MS).toISOString(),
    );
    await webhookService.handleRevenueCatEvent(event({ product_id: 'qulopremiummonthly2' })); // u1, aynı dönem

    expect(bonusRows(fake).map((r) => r.user_id)).toEqual(['u2']);
  });

  it('mağazada abonelik o hesaptaysa (normal satın alma) dönem açılır, bonus yatar', async () => {
    store = { plan: 'premium', expiresAt: new Date(EXPIRES_MS).toISOString() };
    const { fake, webhookService } = await setup();

    await webhookService.handleRevenueCatEvent(event({ product_id: 'qulopremiummonthly2' }));

    expect(fake.table('users')[0]).toMatchObject({ subscription_plan: 'premium', purple_diamonds: 1000 });
    expect(fake.table('user_subscriptions')).toHaveLength(1);
  });
});

/**
 * PRODUCT_CHANGE bilgilendirmedir (RevenueCat: "does not mean that the product change has gone into
 * effect"): `product_id` ESKİ ürün, `expiration_at_ms` eski ürünün kesildiği an. Değişim yürürlüğe
 * girince Apple'da RENEWAL, Google'da INITIAL_PURCHASE yeni ürünle gelir — plan ve bonus oradan.
 *
 * 2026-09-28 canlı olayı: plus alındı, 1 dk sonra premium'a yükseltildi. PRODUCT_CHANGE eski plus'ı
 * "bitişi şimdi" olan yeni bir dönem gibi açtı → +500 mor fazladan yattı ve kullanıcı premium
 * parası ödemişken sunucuda süresi dolmuş plus'ta kaldı.
 */
describe('Apple plus → premium yükseltme olay dizisi', () => {
  const PLUS_EXP = new Date('2026-10-01T12:00:00Z').getTime();
  const PREMIUM_EXP = new Date('2026-10-01T12:01:00Z').getTime();
  const UPGRADE_AT = new Date('2026-09-01T12:01:00Z').getTime();

  const bonuses = (fake: Awaited<ReturnType<typeof setup>>['fake']) =>
    fake.table('diamond_transactions').filter((r) => r.reason === 'SUBSCRIPTION_BONUS');

  it('istemci + webhook sırası (canlıdaki gibi): tek plus + tek premium bonusu, son durum premium', async () => {
    const { fake, webhookService } = await setup();
    const { subscriptionService } = await import('../../src/services/subscription.service.js');

    await webhookService.handleRevenueCatEvent(event({ transaction_id: 'tx-plus', expiration_at_ms: PLUS_EXP }));
    await subscriptionService.activateFromClient(
      'u1', 'premium', 'client_u1', 'tx-prem', new Date(PREMIUM_EXP).toISOString(),
    );
    await webhookService.handleRevenueCatEvent(event({
      type: 'RENEWAL', product_id: 'qulopremiummonthly2', transaction_id: 'tx-prem', expiration_at_ms: PREMIUM_EXP,
    }));
    await webhookService.handleRevenueCatEvent(event({
      type: 'PRODUCT_CHANGE', product_id: 'quloplusmonthly2', transaction_id: 'tx-plus', expiration_at_ms: UPGRADE_AT,
    }));
    await webhookService.handleRevenueCatEvent(event({
      type: 'CANCELLATION', product_id: 'qulopremiummonthly2', transaction_id: 'tx-prem', expiration_at_ms: PREMIUM_EXP,
    }));

    expect(bonuses(fake).map((r) => r.amount)).toEqual([200, 1000]);
    expect(fake.table('users')[0]).toMatchObject({
      subscription_plan: 'premium',
      subscription_expires_at: new Date(PREMIUM_EXP).toISOString(),
      purple_diamonds: 1200,
    });
    // Eski plus dönemi yeni dönem açılınca kapanır; tek güncel satır premium.
    const rows = fake.table('user_subscriptions');
    expect(rows.filter((r) => r.status !== 'expired').map((r) => r.plan)).toEqual(['premium']);
  });

  it('mağaza senkronuyla canlı dizi: her adımda erişim mağazadaki doğru, son durum premium', async () => {
    const plusState = { plan: 'plus' as const, expiresAt: new Date(PLUS_EXP).toISOString() };
    const premiumState = { plan: 'premium' as const, expiresAt: new Date(PREMIUM_EXP).toISOString() };
    const { fake, webhookService } = await setup();

    store = plusState;
    await webhookService.handleRevenueCatEvent(event({ transaction_id: 'tx-plus', expiration_at_ms: PLUS_EXP }));
    expect(fake.table('users')[0]).toMatchObject({ subscription_plan: 'plus' });

    store = premiumState;
    await webhookService.handleRevenueCatEvent(event({
      type: 'RENEWAL', product_id: 'qulopremiummonthly2', transaction_id: 'tx-prem', expiration_at_ms: PREMIUM_EXP,
    }));
    await webhookService.handleRevenueCatEvent(event({
      type: 'PRODUCT_CHANGE', product_id: 'quloplusmonthly2', transaction_id: 'tx-plus', expiration_at_ms: UPGRADE_AT,
    }));
    await webhookService.handleRevenueCatEvent(event({
      type: 'CANCELLATION', product_id: 'qulopremiummonthly2', transaction_id: 'tx-prem', expiration_at_ms: PREMIUM_EXP,
    }));

    expect(bonuses(fake).map((r) => r.amount)).toEqual([200, 1000]);
    expect(fake.table('users')[0]).toMatchObject({
      subscription_plan: 'premium', subscription_expires_at: premiumState.expiresAt, purple_diamonds: 1200,
    });
  });

  // RevenueCat sıra garantisi vermiyor (docs: yalnız yeniden deneme + tekrar).
  it('sıra dışı teslimat: eski plus INITIAL_PURCHASE premium RENEWAL\'dan sonra gelirse erişim mağazadaki premium', async () => {
    store = { plan: 'premium', expiresAt: new Date(PREMIUM_EXP).toISOString() };
    const { fake, webhookService } = await setup();

    await webhookService.handleRevenueCatEvent(event({
      type: 'RENEWAL', product_id: 'qulopremiummonthly2', transaction_id: 'tx-prem', expiration_at_ms: PREMIUM_EXP,
    }));
    await webhookService.handleRevenueCatEvent(event({ transaction_id: 'tx-plus', expiration_at_ms: PLUS_EXP }));

    expect(fake.table('users')[0]).toMatchObject({
      subscription_plan: 'premium', subscription_expires_at: new Date(PREMIUM_EXP).toISOString(),
    });
    // Plus dönemi ödendi — bonusu yine hakkı (dönem anahtarıyla tek).
    expect(bonuses(fake).map((r) => r.amount)).toEqual([1000, 200]);
  });

  it('yalnız webhook (istemci çağrısı yok), PRODUCT_CHANGE RENEWAL\'dan önce: PRODUCT_CHANGE hiçbir şey değiştirmez', async () => {
    const { fake, webhookService } = await setup();

    await webhookService.handleRevenueCatEvent(event({ transaction_id: 'tx-plus', expiration_at_ms: PLUS_EXP }));
    const before = { ...fake.table('users')[0] };

    await webhookService.handleRevenueCatEvent(event({
      type: 'PRODUCT_CHANGE', product_id: 'quloplusmonthly2', transaction_id: 'tx-plus', expiration_at_ms: UPGRADE_AT,
    }));
    expect(fake.table('users')[0]).toEqual(before);
    expect(bonuses(fake)).toHaveLength(1);

    await webhookService.handleRevenueCatEvent(event({
      type: 'RENEWAL', product_id: 'qulopremiummonthly2', transaction_id: 'tx-prem', expiration_at_ms: PREMIUM_EXP,
    }));

    expect(bonuses(fake).map((r) => r.amount)).toEqual([200, 1000]);
    expect(fake.table('users')[0]).toMatchObject({
      subscription_plan: 'premium', subscription_expires_at: new Date(PREMIUM_EXP).toISOString(),
    });
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

  it('abonelik idempotency okuma hatası: hata yükselir ve bağlamıyla loglanır, abonelik yazılmaz', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fake, webhookService } = await setup({}, { failOn: [{ table: 'iap_transactions', op: 'select' }] });

    await expect(webhookService.handleRevenueCatEvent(event())).rejects.toMatchObject({ code: 'SERVER_ERROR' });

    expect(fake.table('users')[0].subscription_plan).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[webhook]'),
      expect.objectContaining({ eventType: 'INITIAL_PURCHASE', transactionId: 'tx-1', error: expect.any(String) }),
    );
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
    process.env.RC_CONSUMABLE_WEBHOOK_CREDIT = 'true'; // kredi yolu gerçekten çalışsın
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

/**
 * Google Play ürün kimlikleri App Store ile birebir aynı DEĞİL: Play'de Premium
 * `qulopremiummonthly` (2'siz), ayrıca RevenueCat base-plan'lı Google aboneliklerini
 * `urun:basePlan` biçiminde gönderebilir. 2026-09-15'e kadar harita yalnız App Store
 * kimliklerini tanıyordu → Android Premium ödemesi gelse bile plan yazılmayacaktı.
 */
describe('Google Play ürün kimlikleri', () => {
  beforeEach(() => { process.env.RC_CONSUMABLE_WEBHOOK_CREDIT = 'true'; });

  it("Play'deki premium kimliği 'qulopremiummonthly' premium plan verir", async () => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent(event({
      product_id: 'qulopremiummonthly', store: 'PLAY_STORE', transaction_id: 'tx-g1',
    }));
    expect(fake.table('users')[0].subscription_plan).toBe('premium');
  });

  it("base plan ekli 'quloplusmonthly2:quloplus-monthly' plus plan verir", async () => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent(event({
      product_id: 'quloplusmonthly2:quloplus-monthly', store: 'PLAY_STORE', transaction_id: 'tx-g2',
    }));
    expect(fake.table('users')[0].subscription_plan).toBe('plus');
  });

  it("satın alma seçeneği ekli 'qulopurple400:qulopurple400-otp' 400 mor yatırır", async () => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent(event({
      type: 'NON_RENEWING_PURCHASE', product_id: 'qulopurple400:qulopurple400-otp', store: 'PLAY_STORE', transaction_id: 'tx-g3',
    }));
    expect(fake.table('users')[0].purple_diamonds).toBe(400);
  });
});
