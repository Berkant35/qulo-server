import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Ödeme doğrulama — RevenueCat HTTP API'sine bakıyor.
 * `env` modülü ve global `fetch` mock'lanıyor; dışarıya hiç istek gitmiyor.
 */

const NOW = new Date('2026-09-01T12:00:00Z');

interface EnvOverrides {
  IAP_SKIP_VALIDATION?: string;
  REVENUECAT_API_KEY?: string;
  NODE_ENV?: string;
}

/** RevenueCat `/subscribers/:id` cevabını taklit eder. */
function mockFetch(response: { status?: number; body?: unknown }) {
  const fn = vi.fn(async () => ({
    ok: (response.status ?? 200) < 400,
    status: response.status ?? 200,
    json: async () => response.body,
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function setup(env: EnvOverrides = { REVENUECAT_API_KEY: 'rc-key' }) {
  vi.doMock('../../src/config/env.js', () => ({
    env: { IAP_SKIP_VALIDATION: '', REVENUECAT_API_KEY: '', ...env },
  }));
  const { revenueCatService } = await import('../../src/services/revenuecat.service.js');
  return revenueCatService;
}

const subscriberBody = (over: Record<string, unknown> = {}) => ({
  subscriber: { subscriptions: {}, non_subscriptions: {}, ...over },
});

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('verifyPurchase', () => {
  it('IAP_SKIP_VALIDATION açıkken API\'ye hiç gitmez', async () => {
    const fetchFn = mockFetch({ body: subscriberBody() });
    const service = await setup({ IAP_SKIP_VALIDATION: 'true' });

    await expect(service.verifyPurchase('u1', 'qulopurple50')).resolves.toMatchObject({ valid: true });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('API key yoksa doğrulama yapılmadı olarak reddeder', async () => {
    const service = await setup({ REVENUECAT_API_KEY: '' });
    await expect(service.verifyPurchase('u1', 'qulopurple50')).resolves.toMatchObject({
      valid: false, error: 'IAP validation not configured',
    });
  });

  it('bilinmeyen kullanıcı (404) reddedilir', async () => {
    mockFetch({ status: 404 });
    const service = await setup();
    await expect(service.verifyPurchase('u1', 'qulopurple50')).resolves.toMatchObject({
      valid: false, error: 'Subscriber not found',
    });
  });

  it('ürün için satın alma yoksa reddedilir', async () => {
    mockFetch({ body: subscriberBody({ non_subscriptions: {} }) });
    const service = await setup();
    await expect(service.verifyPurchase('u1', 'qulopurple50')).resolves.toMatchObject({
      valid: false, error: 'Purchase not found for this product',
    });
  });

  it('boş satın alma listesi reddedilir', async () => {
    mockFetch({ body: subscriberBody({ non_subscriptions: { qulopurple50: [] } }) });
    const service = await setup();
    await expect(service.verifyPurchase('u1', 'qulopurple50')).resolves.toMatchObject({
      valid: false,
    });
  });

  /**
   * İstemci işlem numarası göndermese bile YETKİLİ numara dönmeli: çift kredi
   * korumasının anahtarı bu. Eskiden istemci alanı boş göndererek anahtarı
   * değiştirip aynı satın almayı ikinci kez kredilendirebiliyordu.
   */
  it('satın alma varsa kabul eder ve yetkili transaction id döner', async () => {
    mockFetch({
      body: subscriberBody({ non_subscriptions: { qulopurple50: [{ id: 'tx-1' }] } }),
    });
    const service = await setup();
    await expect(service.verifyPurchase('u1', 'qulopurple50')).resolves.toMatchObject({
      valid: true, transactionId: 'tx-1',
    });
  });

  /** Birden fazla satın alma varsa EN YENİSİ anahtar olur. */
  it('transaction id verilmezse en son satın almanın numarası döner', async () => {
    mockFetch({
      body: subscriberBody({
        non_subscriptions: {
          qulopurple50: [
            { id: 'tx-eski', purchase_date: '2026-09-01T10:00:00Z' },
            { id: 'tx-yeni', purchase_date: '2026-09-05T10:00:00Z' },
          ],
        },
      }),
    });
    const service = await setup();
    await expect(service.verifyPurchase('u1', 'qulopurple50')).resolves.toMatchObject({
      valid: true, transactionId: 'tx-yeni',
    });
  });

  /** Sahte transaction id ile elmas talep etmenin önündeki tek engel. */
  it('eşleşmeyen transaction id reddedilir', async () => {
    mockFetch({
      body: subscriberBody({ non_subscriptions: { qulopurple50: [{ id: 'tx-1' }] } }),
    });
    const service = await setup();
    await expect(service.verifyPurchase('u1', 'qulopurple50', 'sahte-tx')).resolves.toMatchObject({
      valid: false, error: 'Transaction ID not found',
    });
  });

  it('eşleşen transaction id kabul edilir', async () => {
    mockFetch({
      body: subscriberBody({
        non_subscriptions: { qulopurple50: [{ id: 'tx-1' }, { id: 'tx-2' }] },
      }),
    });
    const service = await setup();
    await expect(service.verifyPurchase('u1', 'qulopurple50', 'tx-2')).resolves.toMatchObject({
      valid: true, transactionId: 'tx-2',
    });
  });

  /** API çökünce "geçerli" varsaymamalı — aksi halde downtime bedava elmas demek olurdu. */
  it('API hatası doğrulamayı geçerli saymaz', async () => {
    mockFetch({ status: 500 });
    const service = await setup();
    await expect(service.verifyPurchase('u1', 'qulopurple50')).resolves.toMatchObject({
      valid: false, error: 'Verification service unavailable',
    });
  });

  it('ağ hatası doğrulamayı geçerli saymaz', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const service = await setup();
    await expect(service.verifyPurchase('u1', 'qulopurple50')).resolves.toMatchObject({
      valid: false,
    });
  });

  it('API key Authorization başlığında gider', async () => {
    const fetchFn = mockFetch({ body: subscriberBody() });
    const service = await setup({ REVENUECAT_API_KEY: 'gizli-anahtar' });
    await service.verifyPurchase('u1', 'qulopurple50');

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/subscribers/u1');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gizli-anahtar');
  });
});

describe('verifySubscription', () => {
  it('IAP_SKIP_VALIDATION açıkken 30 günlük geçerlilik uydurur', async () => {
    const service = await setup({ IAP_SKIP_VALIDATION: 'true' });
    const result = await service.verifySubscription('u1', 'quloplusmonthly2');

    expect(result.valid).toBe(true);
    expect(new Date(result.expiresAt!).getTime()).toBe(NOW.getTime() + 30 * 24 * 60 * 60 * 1000);
  });

  it('API key yoksa reddeder', async () => {
    const service = await setup({ REVENUECAT_API_KEY: '' });
    await expect(service.verifySubscription('u1', 'quloplusmonthly2')).resolves.toMatchObject({
      valid: false, error: 'IAP validation not configured',
    });
  });

  it('bilinmeyen kullanıcı reddedilir', async () => {
    mockFetch({ status: 404 });
    const service = await setup();
    await expect(service.verifySubscription('u1', 'quloplusmonthly2')).resolves.toMatchObject({
      valid: false, error: 'Subscriber not found',
    });
  });

  it('ürün için abonelik yoksa reddedilir', async () => {
    mockFetch({ body: subscriberBody({ subscriptions: { baskaurun: {} } }) });
    const service = await setup();
    await expect(service.verifySubscription('u1', 'quloplusmonthly2')).resolves.toMatchObject({
      valid: false, error: 'Subscription not found for this product',
    });
  });

  it('süresi geçmiş abonelik reddedilir', async () => {
    mockFetch({
      body: subscriberBody({
        subscriptions: { quloplusmonthly2: { expires_date: '2026-08-01T00:00:00Z' } },
      }),
    });
    const service = await setup();
    await expect(service.verifySubscription('u1', 'quloplusmonthly2')).resolves.toMatchObject({
      valid: false, error: 'Subscription has expired',
    });
  });

  it('geçerli abonelik bitiş tarihiyle döner', async () => {
    mockFetch({
      body: subscriberBody({
        subscriptions: { quloplusmonthly2: { expires_date: '2026-10-01T00:00:00Z' } },
      }),
    });
    const service = await setup();
    await expect(service.verifySubscription('u1', 'quloplusmonthly2')).resolves.toMatchObject({
      valid: true, expiresAt: '2026-10-01T00:00:00Z',
    });
  });

  it('bitiş tarihi olmayan (ömür boyu) abonelik geçerli sayılır', async () => {
    mockFetch({
      body: subscriberBody({ subscriptions: { quloplusmonthly2: { expires_date: null } } }),
    });
    const service = await setup();
    await expect(service.verifySubscription('u1', 'quloplusmonthly2')).resolves.toMatchObject({
      valid: true,
    });
  });

  it('API hatası geçerli saymaz', async () => {
    mockFetch({ status: 503 });
    const service = await setup();
    await expect(service.verifySubscription('u1', 'quloplusmonthly2')).resolves.toMatchObject({
      valid: false, error: 'Verification service unavailable',
    });
  });
});

/**
 * "Ödenmiş" uygunluğu RevenueCat verisinden (F4): sandbox / aile paylaşımı / TRIAL-INTRO-PROMOTIONAL
 * 0 TL'lik "ödenmiş" mor üretmesin. API v1 alanları: non_subscriptions[].is_sandbox;
 * subscriptions[p].is_sandbox, period_type (küçük harf: normal/trial/intro/…), ownership_type
 * (PURCHASED | FAMILY_SHARED). Alan yoksa uygun değil.
 */
describe('ödenmiş uygunluğu', () => {
  it('verifyPurchase: is_sandbox false → paidEligible true', async () => {
    mockFetch({ body: subscriberBody({ non_subscriptions: { qulopurple50: [{ id: 'tx-1', is_sandbox: false }] } }) });
    const service = await setup();
    await expect(service.verifyPurchase('u1', 'qulopurple50')).resolves.toMatchObject({
      valid: true, isSandbox: false, paidEligible: true,
    });
  });

  it('verifyPurchase: sandbox → paidEligible false', async () => {
    mockFetch({ body: subscriberBody({ non_subscriptions: { qulopurple50: [{ id: 'tx-1', is_sandbox: true }] } }) });
    const service = await setup();
    await expect(service.verifyPurchase('u1', 'qulopurple50', 'tx-1')).resolves.toMatchObject({
      valid: true, isSandbox: true, paidEligible: false,
    });
  });

  it('verifyPurchase: is_sandbox yoksa paidEligible false', async () => {
    mockFetch({ body: subscriberBody({ non_subscriptions: { qulopurple50: [{ id: 'tx-1' }] } }) });
    const service = await setup();
    await expect(service.verifyPurchase('u1', 'qulopurple50')).resolves.toMatchObject({ valid: true, paidEligible: false });
  });

  const sub = (over: Record<string, unknown>) => subscriberBody({
    subscriptions: {
      quloplusmonthly2: {
        expires_date: '2026-10-01T00:00:00Z', is_sandbox: false, period_type: 'normal', ownership_type: 'PURCHASED', ...over,
      },
    },
  });

  it('verifySubscription: gerçek, normal, kendi satın alması → alanlar + paidEligible true', async () => {
    mockFetch({ body: sub({}) });
    const service = await setup();
    await expect(service.verifySubscription('u1', 'quloplusmonthly2')).resolves.toEqual({
      valid: true, expiresAt: '2026-10-01T00:00:00Z',
      isSandbox: false, periodType: 'normal', ownershipType: 'PURCHASED', paidEligible: true,
    });
  });

  it.each([
    ['sandbox', { is_sandbox: true }],
    ['deneme', { period_type: 'trial' }],
    ['giriş teklifi', { period_type: 'intro' }],
    ['promosyon', { period_type: 'promotional' }],
    ['aile paylaşımı', { ownership_type: 'FAMILY_SHARED' }],
    ['ownership_type yok', { ownership_type: undefined }],
    ['period_type yok', { period_type: undefined }],
    ['is_sandbox yok', { is_sandbox: undefined }],
  ])('verifySubscription: %s → paidEligible false', async (_label, over) => {
    mockFetch({ body: sub(over) });
    const service = await setup();
    await expect(service.verifySubscription('u1', 'quloplusmonthly2')).resolves.toMatchObject({
      valid: true, paidEligible: false,
    });
  });
});

/**
 * Tek satın alma = tek kredi, iki yoldan da (F5). Webhook `transaction_id` MAĞAZA işlem numarası
 * taşır; istemci yolu eskiden RevenueCat'in kendi `id`'sini anahtar yapıyordu → aynı alım iki
 * farklı referansla iki kez kredilenebilirdi. Artık istemci yolu da mağaza numarasını döner
 * (API v1 non_subscriptions[].store_transaction_id), yoksa RC id'ye düşer.
 */
describe('verifyPurchase — mağaza işlem numarası (F5)', () => {
  it('store_transaction_id varsa referans odur', async () => {
    mockFetch({
      body: subscriberBody({
        non_subscriptions: { qulopurple50: [{ id: 'o1_rc', store_transaction_id: '2000000123', is_sandbox: false }] },
      }),
    });
    const service = await setup();
    await expect(service.verifyPurchase('u1', 'qulopurple50')).resolves.toMatchObject({
      valid: true, transactionId: '2000000123',
    });
  });

  it('istemci RC id gönderir (mobil transactionIdentifier) — eşleşir, referans yine mağaza numarası', async () => {
    mockFetch({
      body: subscriberBody({
        non_subscriptions: {
          qulopurple50: [
            { id: 'o1_a', store_transaction_id: 'GPA.1', is_sandbox: false },
            { id: 'o1_b', store_transaction_id: 'GPA.2', is_sandbox: false },
          ],
        },
      }),
    });
    const service = await setup();
    await expect(service.verifyPurchase('u1', 'qulopurple50', 'o1_b')).resolves.toMatchObject({
      valid: true, transactionId: 'GPA.2',
    });
  });

  it('istemci mağaza numarasını gönderirse de eşleşir', async () => {
    mockFetch({
      body: subscriberBody({ non_subscriptions: { qulopurple50: [{ id: 'o1_a', store_transaction_id: 'GPA.1' }] } }),
    });
    const service = await setup();
    await expect(service.verifyPurchase('u1', 'qulopurple50', 'GPA.1')).resolves.toMatchObject({
      valid: true, transactionId: 'GPA.1',
    });
  });
});

describe('IAP_SKIP_VALIDATION (F5)', () => {
  it('production\'da bayrak YOK SAYILIR: RevenueCat yine sorulur, sahte alım reddedilir', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchFn = mockFetch({ body: subscriberBody({ non_subscriptions: {} }) });
    const service = await setup({ IAP_SKIP_VALIDATION: 'true', REVENUECAT_API_KEY: 'rc-key', NODE_ENV: 'production' });

    await expect(service.verifyPurchase('u1', 'qulopurple50')).resolves.toMatchObject({ valid: false });
    await expect(service.verifySubscription('u1', 'quloplusmonthly2')).resolves.toMatchObject({ valid: false });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    // Uyarı bir kez (her istekte log gürültüsü yok).
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('IAP_SKIP_VALIDATION'))).toHaveLength(1);
    warn.mockRestore();
  });

  it('production dışı atlanınca ödenmiş sayılmaz (paidEligible false)', async () => {
    const service = await setup({ IAP_SKIP_VALIDATION: 'true', NODE_ENV: 'development' });
    await expect(service.verifyPurchase('u1', 'qulopurple50')).resolves.toEqual({
      valid: true, validationSkipped: true, paidEligible: false,
    });
    await expect(service.verifySubscription('u1', 'quloplusmonthly2')).resolves.toMatchObject({
      valid: true, validationSkipped: true, paidEligible: false,
    });
  });
});
