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

describe('ödenmiş mor kaynakları', () => {
  it('tüketilebilir IAP tamamen ödenmiş sayılır', async () => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent({
      type: 'NON_RENEWING_PURCHASE', app_user_id: 'u1', product_id: 'qulopurple50', store: 'APP_STORE', transaction_id: 'tx-1',
    });
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 50, purple_paid: 50 });
  });

  it('Plus bonusu %30 ödenmiş sayılır', async () => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent({
      type: 'INITIAL_PURCHASE', app_user_id: 'u1', product_id: 'quloplusmonthly2', store: 'APP_STORE',
      expiration_at_ms: EXPIRES_MS, transaction_id: 'tx-plus',
    });
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 200, purple_paid: 60 });
  });

  it('Premium bonusu %20 ödenmiş sayılır', async () => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent({
      type: 'INITIAL_PURCHASE', app_user_id: 'u1', product_id: 'qulopremiummonthly2', store: 'APP_STORE',
      expiration_at_ms: EXPIRES_MS, transaction_id: 'tx-prem',
    });
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 1000, purple_paid: 200 });
  });
});
