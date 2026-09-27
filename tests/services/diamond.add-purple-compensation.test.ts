import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';

/**
 * addPurple ÖNCE claim satırını yazar, sonra bakiyeyi CAS ile artırır (çift kredi dersi, 047).
 * Bakiye yazılmadıysa claim KALIRSA tekrar deneme duplicate guard'a takılır ve gerçek satın alma
 * kaybolur; yazım belirsizse (update hata döndü ama commit edilmiş olabilir) claim silinirse çift
 * kredi olur. Bu dosya iki yönü ayrı ayrı sınar.
 */
async function setup(seed: Tables, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase(seed, options);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { diamondService } = await import('../../src/services/diamond.service.js');
  return { fake, diamondService };
}

const seed = () => ({
  users: [{ id: 'u1', green_diamonds: 0, purple_diamonds: 0, purple_paid: 0, rainbow_diamonds: 0 }],
  diamond_transactions: [],
});

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('addPurple — claim telafisi', () => {
  it('CAS okuması patlarsa hiçbir şey yazılmamıştır: claim silinir (tekrar deneme krediyi verir)', async () => {
    const { fake, diamondService } = await setup(seed(), { failOn: [{ table: 'users', op: 'select' }] });

    await expect(diamondService.addPurple('u1', 150, 'IAP_PURCHASE', 'tx-1', 150)).rejects.toMatchObject({
      code: 'SERVER_ERROR',
    });
    expect(fake.table('diamond_transactions')).toHaveLength(0);
    expect(fake.table('users')[0].purple_diamonds).toBe(0);
  });

  it('update isteği hata dönerse yazım belirsiz: claim KALIR (silinirse çift kredi riski)', async () => {
    const { fake, diamondService } = await setup(seed(), { failOn: [{ table: 'users', op: 'update' }] });

    await expect(diamondService.addPurple('u1', 150, 'IAP_PURCHASE', 'tx-1', 150)).rejects.toMatchObject({
      code: 'SERVER_ERROR',
    });
    expect(fake.table('diamond_transactions')).toEqual([
      expect.objectContaining({ reason: 'IAP_PURCHASE', reference_id: 'tx-1' }),
    ]);
    // Belirsiz yazım sessiz kalmaz: elle mutabakat için claim ve bağlam CRITICAL loglanır.
    const claimId = fake.table('diamond_transactions')[0].id;
    const critical = vi.mocked(console.error).mock.calls.find((c) => String(c[0]).includes('CRITICAL'));
    expect(critical?.[1]).toMatchObject({
      claimId, userId: 'u1', referenceId: 'tx-1', reason: 'IAP_PURCHASE', amount: 150, cause: 'cas_write_uncertain',
    });
  });

  it('CAS tükenirse claim silinir (mevcut davranış korunur)', async () => {
    const { fake, diamondService } = await setup(seed(), {
      interleave: [{ table: 'users', times: 3, mutate: (rows) => { rows[0].purple_diamonds += 1; } }],
    });

    await expect(diamondService.addPurple('u1', 150, 'IAP_PURCHASE', 'tx-1', 150)).rejects.toMatchObject({
      code: 'SERVER_ERROR',
    });
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });
});
