import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Ödeme doğrulama — RevenueCat HTTP API'sine bakıyor.
 * `env` modülü ve global `fetch` mock'lanıyor; dışarıya hiç istek gitmiyor.
 */

const NOW = new Date('2026-09-01T12:00:00Z');

interface EnvOverrides {
  IAP_SKIP_VALIDATION?: string;
  REVENUECAT_API_KEY?: string;
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

    await expect(service.verifyPurchase('u1', 'qulopurple50')).resolves.toEqual({ valid: true });
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

  it('satın alma varsa kabul eder', async () => {
    mockFetch({
      body: subscriberBody({ non_subscriptions: { qulopurple50: [{ id: 'tx-1' }] } }),
    });
    const service = await setup();
    await expect(service.verifyPurchase('u1', 'qulopurple50')).resolves.toEqual({ valid: true });
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
    await expect(service.verifyPurchase('u1', 'qulopurple50', 'tx-2')).resolves.toEqual({
      valid: true,
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
    await expect(service.verifySubscription('u1', 'quloplusmonthly2')).resolves.toEqual({
      valid: true, expiresAt: '2026-10-01T00:00:00Z',
    });
  });

  it('bitiş tarihi olmayan (ömür boyu) abonelik geçerli sayılır', async () => {
    mockFetch({
      body: subscriberBody({ subscriptions: { quloplusmonthly2: { expires_date: null } } }),
    });
    const service = await setup();
    await expect(service.verifySubscription('u1', 'quloplusmonthly2')).resolves.toEqual({
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
