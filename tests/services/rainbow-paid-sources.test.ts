import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';

/** Fixture: plus bonus 200 (pay 0,3 → 60 ödenmiş), premium 1000 (pay 0,2 → 200 ödenmiş). */
async function setup(seed: Tables = {}) {
  const fake = createFakeSupabase({
    economy_config_versions: [activeConfigRow()],
    users: [{
      id: 'u1', green_diamonds: 0, purple_diamonds: 0, purple_paid: 0, rainbow_diamonds: 0,
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

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Gerçek (PRODUCTION, kendi satın alması, tam fiyat) RevenueCat olayı alanları — webhook her olayda yollar. */
const REAL = { environment: 'PRODUCTION', is_family_share: false, period_type: 'NORMAL' } as const;

describe('ödenmiş mor kaynakları', () => {
  it('tüketilebilir IAP tamamen ödenmiş sayılır', async () => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent({
      type: 'NON_RENEWING_PURCHASE', app_user_id: 'u1', product_id: 'qulopurple50', store: 'APP_STORE', transaction_id: 'tx-1',
      ...REAL,
    });
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 50, purple_paid: 50 });
  });

  it('Plus bonusu %30 ödenmiş sayılır', async () => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent({
      type: 'INITIAL_PURCHASE', app_user_id: 'u1', product_id: 'quloplusmonthly2', store: 'APP_STORE',
      expiration_at_ms: EXPIRES_MS, transaction_id: 'tx-plus', ...REAL,
    });
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 200, purple_paid: 60 });
  });

  it('Premium bonusu %20 ödenmiş sayılır', async () => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent({
      type: 'INITIAL_PURCHASE', app_user_id: 'u1', product_id: 'qulopremiummonthly2', store: 'APP_STORE',
      expiration_at_ms: EXPIRES_MS, transaction_id: 'tx-prem', ...REAL,
    });
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 1000, purple_paid: 200 });
  });
});

/**
 * Yalnız gerçek, tam fiyatlı, kendi satın alması "ödenmiş" (controller kararı 2026-09-27):
 * sandbox (TestFlight / lisans testçisi), aile paylaşımı ve TRIAL/INTRO/PROMOTIONAL dönemi
 * 0 TL'lik "ödenmiş" mor → rainbow → hediye kartı üretirdi. Mor yine yatar; yalnız etiket 0.
 */
describe('ödenmiş sayılmayan satın almalar (mor yatar, purple_paid 0)', () => {
  const consumable = (over: Record<string, unknown>) => ({
    type: 'NON_RENEWING_PURCHASE', app_user_id: 'u1', product_id: 'qulopurple50', store: 'APP_STORE',
    transaction_id: 'tx-c', ...REAL, ...over,
  });
  const initial = (over: Record<string, unknown>) => ({
    type: 'INITIAL_PURCHASE', app_user_id: 'u1', product_id: 'quloplusmonthly2', store: 'APP_STORE',
    expiration_at_ms: EXPIRES_MS, transaction_id: 'tx-s', ...REAL, ...over,
  });

  it('sandbox tüketilebilir', async () => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent(consumable({ environment: 'SANDBOX' }));
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 50, purple_paid: 0 });
    expect(fake.table('diamond_transactions')[0].paid_amount).toBeUndefined();
  });

  it('aile paylaşımlı tüketilebilir', async () => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent(consumable({ is_family_share: true }));
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 50, purple_paid: 0 });
  });

  it('ortam alanı yoksa (bilinmiyor) ödenmiş sayılmaz', async () => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent(consumable({ environment: undefined }));
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 50, purple_paid: 0 });
  });

  it.each(['TRIAL', 'INTRO', 'PROMOTIONAL'])('%s abonelik: bonus yatar, ödenmiş 0', async (period_type) => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent(initial({ period_type }));
    expect(fake.table('users')[0]).toMatchObject({ subscription_plan: 'plus', purple_diamonds: 200, purple_paid: 0 });
  });

  it('sandbox NORMAL abonelik: ödenmiş 0', async () => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent(initial({ environment: 'SANDBOX' }));
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 200, purple_paid: 0 });
  });

  it('aile paylaşımlı abonelik: ödenmiş 0', async () => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent(initial({ is_family_share: true }));
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 200, purple_paid: 0 });
  });
});

describe('yenileme ve plan değişimi', () => {
  const renewalSeed = () => ({
    users: [{
      id: 'u1', green_diamonds: 0, purple_diamonds: 0, purple_paid: 0, rainbow_diamonds: 0,
      subscription_plan: 'plus', subscription_expires_at: '2026-09-01T12:00:00Z', rc_customer_id: 'rc-1',
    }],
    user_subscriptions: [{ id: 's1', user_id: 'u1', plan: 'plus', status: 'active' }],
  });
  const renewal = (over: Record<string, unknown> = {}) => ({
    type: 'RENEWAL', app_user_id: 'u1', product_id: 'quloplusmonthly2', store: 'PLAY_STORE',
    expiration_at_ms: EXPIRES_MS, transaction_id: 'tx-r', ...REAL, ...over,
  });

  it('RENEWAL (NORMAL, PRODUCTION) bonusun tier payını ödenmiş sayar', async () => {
    const { fake, webhookService } = await setup(renewalSeed());
    await webhookService.handleRevenueCatEvent(renewal());
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 200, purple_paid: 60 });
    expect(fake.table('diamond_transactions')[0]).toMatchObject({ reason: 'SUBSCRIPTION_BONUS', amount: 200, paid_amount: 60 });
  });

  it('RENEWAL sandbox: bonus yatar, ödenmiş 0', async () => {
    const { fake, webhookService } = await setup(renewalSeed());
    await webhookService.handleRevenueCatEvent(renewal({ environment: 'SANDBOX' }));
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 200, purple_paid: 0 });
  });

  it('PRODUCT_CHANGE (NORMAL, PRODUCTION) yeni planın payını ödenmiş sayar', async () => {
    const { fake, webhookService } = await setup(renewalSeed());
    await webhookService.handleRevenueCatEvent(renewal({ type: 'PRODUCT_CHANGE', product_id: 'qulopremiummonthly2', transaction_id: 'tx-pc' }));
    expect(fake.table('users')[0]).toMatchObject({ subscription_plan: 'premium', purple_diamonds: 1000, purple_paid: 200 });
  });
});
