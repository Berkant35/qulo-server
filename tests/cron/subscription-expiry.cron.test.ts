import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';

const NOW = new Date('2026-11-09T04:10:00.000Z');
const D = 24 * 3600 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

async function setup(tables: Tables, failOn?: Array<{ table: string; op: string }>) {
  const fake = createFakeSupabase(tables, failOn ? { failOn: failOn as never } : {});
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const cron = await import('../../src/cron/subscription-expiry.cron.js');
  const { subscriptionService } = await import('../../src/services/subscription.service.js');
  return { fake, cron, subscriptionService };
}

const row = (id: string, status: string, expiresAgoMs: number, user = 'u1') =>
  ({ id, user_id: user, plan: 'premium', status, expires_at: ago(expiresAgoMs), updated_at: ago(40 * D) });

beforeEach(() => vi.resetModules());
afterEach(() => vi.restoreAllMocks());

describe('subscription-expiry (webhook\'u gelmeyen abonelikler aylarca active kaldi, 2026-11-09)', () => {
  it('3 gun payi gecmis active ve cancelled satirlar expired olur; pay icindeki ve gelecek satira dokunulmaz', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { fake, cron } = await setup({
      user_subscriptions: [
        row('old-active', 'active', 117 * D),
        row('old-cancelled', 'cancelled', 10 * D),
        row('in-grace', 'active', 2 * D),
        row('future', 'active', -20 * D),
        row('already', 'expired', 50 * D),
      ],
    });
    await cron.subscriptionExpiryTick(NOW);
    const byId = Object.fromEntries(fake.table('user_subscriptions').map((r) => [r.id, r.status]));
    expect(byId).toEqual({ 'old-active': 'expired', 'old-cancelled': 'expired', 'in-grace': 'active', future: 'active', already: 'expired' });
  });

  it('kapatilan satir sayisini doner', async () => {
    const { subscriptionService } = await setup({ user_subscriptions: [row('a', 'active', 30 * D), row('b', 'active', 40 * D, 'u2')] });
    expect(await subscriptionService.expireLapsedRows(NOW)).toBe(2);
  });

  it('DB hatasi tiki dusurmez (loglanir, firlatmaz)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { cron } = await setup({ user_subscriptions: [row('a', 'active', 30 * D)] }, [{ table: 'user_subscriptions', op: 'update' }]);
    await expect(cron.subscriptionExpiryTick(NOW)).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledWith('[SubscriptionExpiryCron] Error:', expect.stringContaining('expiry sweep failed'));
  });

  it('gunde bir, 04:10', async () => {
    const { cron } = await setup({ user_subscriptions: [] });
    expect(cron.subscriptionExpiryCron.schedule).toBe('10 4 * * *');
    expect(cron.subscriptionExpiryCron.name).toBe('subscription-expiry');
  });

  it('tarama sonrasi gec gelen RENEWAL en yeni satiri yeniden acar (abonelik kaydi expired kalmaz)', async () => {
    vi.doMock('../../src/services/diamond.service.js', () => ({ diamondService: { addPurple: vi.fn() } }));
    vi.doMock('../../src/services/economy-config.service.js', () => ({
      economyConfigService: { getConfig: async () => ({ subscriptionLimits: { premium: { monthlyPurpleBonus: 0 } } }) },
    }));
    const { fake, subscriptionService } = await setup({
      user_subscriptions: [row('older', 'expired', 60 * D), row('latest', 'expired', 5 * D)],
      users: [{ id: 'u1', subscription_plan: 'premium', subscription_expires_at: ago(5 * D) }],
    });
    const newExpiry = new Date(NOW.getTime() + 25 * D).toISOString();
    await subscriptionService.renewSubscription('u1', 'premium', 'tx-9', newExpiry);
    const byId = Object.fromEntries(fake.table('user_subscriptions').map((r) => [r.id, r]));
    expect(byId.latest).toMatchObject({ status: 'active', expires_at: newExpiry, store_transaction_id: 'tx-9' });
    expect(byId.older.status).toBe('expired');
  });

  it('RENEWAL satir guncellemesi hata verirse en yeni satir yeniden ACILMAZ (hata loglanir, users yine yenilenir)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.doMock('../../src/services/diamond.service.js', () => ({ diamondService: { addPurple: vi.fn() } }));
    vi.doMock('../../src/services/economy-config.service.js', () => ({
      economyConfigService: { getConfig: async () => ({ subscriptionLimits: { premium: { monthlyPurpleBonus: 0 } } }) },
    }));
    const { fake, subscriptionService } = await setup(
      { user_subscriptions: [row('latest', 'expired', 5 * D)], users: [{ id: 'u1', subscription_plan: 'premium', subscription_expires_at: ago(5 * D) }] },
      [{ table: 'user_subscriptions', op: 'update' }],
    );
    const newExpiry = new Date(NOW.getTime() + 25 * D).toISOString();
    await subscriptionService.renewSubscription('u1', 'premium', 'tx-9', newExpiry);
    expect(fake.table('user_subscriptions')[0]!.status).toBe('expired');
    expect(fake.table('users')[0]!.subscription_expires_at).toBe(newExpiry);
    expect(err).toHaveBeenCalledWith('[subscription] renewal row update failed:', expect.any(String));
  });
});
