import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';

/**
 * Tüketilebilir IAP iadesi (spec §2.7 + Plan 2 "uyarı yayılsın"): bakiye geri alınmaz; satın almanın
 * ödenmiş payı sayaçtan düşer; iade eden ve onun satın almadan SONRAKİ ödenmiş harcamalarından
 * rainbow kazananlar işaretlenir. Zincir gerçek webhookService + diamondService ile sınanır.
 */
async function setup(seed: Tables = {}, options: FakeSupabaseOptions = {}) {
  const fake = createFakeSupabase(
    {
      economy_config_versions: [activeConfigRow()],
      iap_transactions: [],
      users: [
        { id: 'u1', green_diamonds: 0, purple_diamonds: 250, purple_paid: 200, rainbow_diamonds: 0, rainbow_flagged_at: null },
        { id: 'u2', green_diamonds: 0, purple_diamonds: 0, purple_paid: 0, rainbow_diamonds: 10, rainbow_flagged_at: null },
        { id: 'u3', green_diamonds: 5, purple_diamonds: 0, purple_paid: 0, rainbow_diamonds: 5, rainbow_flagged_at: null },
        { id: 'u4', green_diamonds: 0, purple_diamonds: 0, purple_paid: 0, rainbow_diamonds: 2, rainbow_flagged_at: null },
      ],
      diamond_transactions: [
        // Satın alma (iade edilecek): 150 mor, tamamı ödenmiş.
        { id: 'd-iap', user_id: 'u1', type: 'PURPLE', amount: 150, paid_amount: 150, reason: 'IAP_PURCHASE', reference_id: 'tx-9', created_at: '2026-09-10T00:00:00Z' },
        // Satın almadan SONRA ödenmiş harcama → u2 rainbow kazandı (aynı referans).
        { id: 'd-s1', user_id: 'u1', type: 'PURPLE', amount: -40, paid_amount: 40, reason: 'POWER_USED:HALF', reference_id: 'sess-1', created_at: '2026-09-11T00:00:00Z' },
        { id: 'd-r1', user_id: 'u2', type: 'RAINBOW', amount: 10, paid_amount: 0, reason: 'POWER_REWARD:HALF', reference_id: 'sess-1', created_at: '2026-09-11T00:00:01Z' },
        // Bedava harcama → u3 yalnız yeşil kazandı.
        { id: 'd-s2', user_id: 'u1', type: 'PURPLE', amount: -20, paid_amount: 0, reason: 'POWER_USED:HALF', reference_id: 'sess-2', created_at: '2026-09-12T00:00:00Z' },
        { id: 'd-g2', user_id: 'u3', type: 'GREEN', amount: 5, paid_amount: 0, reason: 'POWER_REWARD:HALF', reference_id: 'sess-2', created_at: '2026-09-12T00:00:01Z' },
        // Satın almadan ÖNCEKİ ödenmiş harcama → u4 (bu satın almayla ilgisiz).
        { id: 'd-s0', user_id: 'u1', type: 'PURPLE', amount: -10, paid_amount: 10, reason: 'POWER_USED:HALF', reference_id: 'sess-0', created_at: '2026-09-01T00:00:00Z' },
        { id: 'd-r0', user_id: 'u4', type: 'RAINBOW', amount: 2, paid_amount: 0, reason: 'POWER_REWARD:HALF', reference_id: 'sess-0', created_at: '2026-09-01T00:00:01Z' },
        // İlgisiz rainbow.
        { id: 'd-x', user_id: 'u3', type: 'RAINBOW', amount: 5, paid_amount: 0, reason: 'POWER_REWARD:HALF', reference_id: 'other', created_at: '2026-09-13T00:00:00Z' },
      ],
      ...seed,
    },
    { unique: { iap_transactions: ['transaction_id'] }, ...options },
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { webhookService } = await import('../../src/services/webhook.service.js');
  return { fake, webhookService };
}

const refund = (over: Record<string, unknown> = {}) => ({
  type: 'CANCELLATION', app_user_id: 'u1', product_id: 'qulopurple150', store: 'APP_STORE',
  transaction_id: 'tx-9', expiration_at_ms: null, cancel_reason: 'CUSTOMER_SUPPORT', price: -4.99,
  environment: 'PRODUCTION',
  ...over,
});

const flagged = (fake: { table(n: string): Array<Record<string, unknown>> }) =>
  fake.table('users').filter((u) => u.rainbow_flagged_at).map((u) => u.id);

beforeEach(() => {
  vi.resetModules();
});

describe('tüketilebilir iade (CANCELLATION)', () => {
  it('bakiye geri alınmaz; ödenmiş sayaç satın almanın payı kadar düşer; iade eden + ödenmiş harcamasından rainbow kazanan işaretlenir', async () => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent(refund());

    const u1 = fake.table('users').find((u) => u.id === 'u1')!;
    expect(u1.purple_diamonds).toBe(250);
    expect(u1.purple_paid).toBe(50);
    expect(flagged(fake).sort()).toEqual(['u1', 'u2']);
    expect(fake.table('iap_transactions')).toEqual([
      expect.objectContaining({
        user_id: 'u1', transaction_id: 'refund:tx-9', rc_event_type: 'CANCELLATION', store: 'apple', amount_usd: -4.99,
      }),
    ]);
  });

  it('tekrarlanan olay (RevenueCat retry) bir kez işlenir: sayaç ikinci kez düşmez', async () => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent(refund());
    await webhookService.handleRevenueCatEvent(refund());

    expect(fake.table('users').find((u) => u.id === 'u1')!.purple_paid).toBe(50);
    expect(fake.table('iap_transactions')).toHaveLength(1);
  });

  it("sayaç 0'ın altına inmez (ödenmiş mor zaten harcanmış)", async () => {
    const { fake, webhookService } = await setup();
    fake.table('users').find((u) => u.id === 'u1')!.purple_paid = 30;
    await webhookService.handleRevenueCatEvent(refund());
    expect(fake.table('users').find((u) => u.id === 'u1')!.purple_paid).toBe(0);
  });

  it('ilk işaret zamanı korunur (tekrar işaretleme tarihi ileri kaydırmaz)', async () => {
    const { fake, webhookService } = await setup();
    fake.table('users').find((u) => u.id === 'u2')!.rainbow_flagged_at = '2026-09-01T00:00:00Z';
    await webhookService.handleRevenueCatEvent(refund());
    expect(fake.table('users').find((u) => u.id === 'u2')!.rainbow_flagged_at).toBe('2026-09-01T00:00:00Z');
  });

  it('defterde bulunmayan satın alma: yalnız iade eden işaretlenir, sayaç değişmez', async () => {
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent(refund({ transaction_id: 'tx-bilinmeyen' }));
    expect(flagged(fake)).toEqual(['u1']);
    expect(fake.table('users').find((u) => u.id === 'u1')!.purple_paid).toBe(200);
  });

  it('işlem numarası yoksa hiçbir şey yazılmaz', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fake, webhookService } = await setup();
    await webhookService.handleRevenueCatEvent(refund({ transaction_id: undefined }));
    expect(flagged(fake)).toEqual([]);
    expect(fake.table('iap_transactions')).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it('claim sonrası hata: claim silinir (RevenueCat yeniden dener) ve hata yükselir', async () => {
    const { fake, webhookService } = await setup({}, { failOn: [{ table: 'users', op: 'update' }] });
    await expect(webhookService.handleRevenueCatEvent(refund())).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(fake.table('iap_transactions')).toHaveLength(0);
  });
});
