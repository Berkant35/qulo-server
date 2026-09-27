import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';

const NOW = new Date('2026-09-27T12:00:00Z');

async function setup(seed: Tables = {}, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase(
    { reward_redemptions: [], diamond_transactions: [], users: [], ...seed },
    options,
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { rewardsAdminService } = await import('../../src/services/rewards-admin.service.js');
  return { fake, rewardsAdminService };
}

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1', email: 'ali@example.com', name: 'Ali', country: 'TH', rainbow_diamonds: 100,
  rainbow_flagged_at: null, is_deleted: false, green_diamonds: 0, purple_diamonds: 0, purple_paid: 0,
  ...over,
});

const redemption = (over: Record<string, unknown>) => ({
  id: 'r1', user_id: 'u1', item_id: 'i-grab', status: 'PENDING', rainbow_price: 51, brand_key: 'GRAB',
  country_code: 'TH', currency: 'THB', face_value: 50, delivery_code: null, delivery_url: null,
  admin_note: null, reject_reason: null, idempotency_key: 'k1-000000', platform: 'android', is_test: false,
  created_at: '2026-09-20T00:00:00Z', decided_at: null, decided_by: null,
  ...over,
});

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rewardsAdminService.listRedemptions', () => {
  it('varsayılan PENDING, en eski önce; kod maskeli; kullanıcı + uyarı + bu ay toplamı eklenir', async () => {
    const { rewardsAdminService } = await setup({
      users: [user({ rainbow_flagged_at: '2026-09-25T00:00:00Z' }), user({ id: 'u2', email: 'ayse@example.com', country: 'ID' })],
      reward_redemptions: [
        redemption({ id: 'r-new', created_at: '2026-09-22T00:00:00Z', idempotency_key: 'k1-000000' }),
        redemption({ id: 'r-old', user_id: 'u2', created_at: '2026-09-21T00:00:00Z', idempotency_key: 'k2-000000' }),
        redemption({ id: 'r-done', status: 'FULFILLED', rainbow_price: 22, delivery_code: 'GRAB-ABCD-1234', created_at: '2026-09-05T00:00:00Z', idempotency_key: 'k3-000000' }),
        redemption({ id: 'r-last-month', status: 'FULFILLED', rainbow_price: 101, created_at: '2026-08-30T00:00:00Z', idempotency_key: 'k4-000000' }),
      ],
    });

    const page = await rewardsAdminService.listRedemptions({ status: 'PENDING', page: 1 });

    expect(page.items.map((r) => r.id)).toEqual(['r-old', 'r-new']);
    expect(page.total).toBe(2);
    const rNew = page.items[1];
    expect(rNew.user).toMatchObject({ id: 'u1', email: 'ali@example.com', country: 'TH', rainbow_flagged_at: '2026-09-25T00:00:00Z' });
    expect(rNew.user_month_total).toBe(73);
    expect(rNew).not.toHaveProperty('delivery_code');
  });

  it('sonuçlananlar en yeni önce; teslim kodu ve linki yalnız maskeli/host olarak döner', async () => {
    const { rewardsAdminService } = await setup({
      users: [user()],
      reward_redemptions: [
        redemption({
          id: 'r-a', status: 'FULFILLED', delivery_code: 'GRAB-ABCD-1234',
          delivery_url: 'https://g.example/claim/SECRET123', created_at: '2026-09-05T00:00:00Z', idempotency_key: 'k1-000000',
        }),
        redemption({ id: 'r-b', status: 'REJECTED', reject_reason: 'stok yok', created_at: '2026-09-06T00:00:00Z', idempotency_key: 'k2-000000' }),
      ],
    });

    const page = await rewardsAdminService.listRedemptions({ status: 'ALL', page: 1 });
    expect(page.items.map((r) => r.id)).toEqual(['r-b', 'r-a']);
    expect(page.items[1].masked_code).toBe('••••1234');
    expect(page.items[1].delivery_host).toBe('g.example');
    expect(page.items[1]).not.toHaveProperty('delivery_url');
    expect(JSON.stringify(page)).not.toContain('GRAB-ABCD-1234');
    expect(JSON.stringify(page)).not.toContain('SECRET123');
  });

  it('e-posta araması ve ülke filtresi; eşleşme yoksa talep sorgusu atılmaz', async () => {
    const { fake, rewardsAdminService } = await setup({
      users: [user(), user({ id: 'u2', email: 'ayse@example.com' })],
      reward_redemptions: [
        redemption({ id: 'r1', idempotency_key: 'k1-000000' }),
        redemption({ id: 'r2', user_id: 'u2', country_code: 'ID', idempotency_key: 'k2-000000' }),
      ],
    });

    expect((await rewardsAdminService.listRedemptions({ status: 'ALL', q: 'ayse', page: 1 })).items.map((r) => r.id)).toEqual(['r2']);
    expect((await rewardsAdminService.listRedemptions({ status: 'ALL', country: 'TH', page: 1 })).items.map((r) => r.id)).toEqual(['r1']);

    // '_' kaçışsız bırakılsaydı (eski davranış: joker karakterleri silme) tek-karakter jokeri
    // olarak HER e-postaya uyar, eşleşme bulunur ve talep sorgusu atılırdı — bu yüzden bu
    // olmadan da yeşil kalan zayıf bir "hiç eşleşme yok" iddiası değil, kaçışın kendisi sınanıyor.
    const before = fake.queries.filter((q) => q.table === 'reward_redemptions').length;
    const none = await rewardsAdminService.listRedemptions({ status: 'ALL', q: '_', page: 1 });
    expect(none).toEqual({ items: [], total: 0, page: 1, pageSize: 30 });
    expect(fake.queries.filter((q) => q.table === 'reward_redemptions').length).toBe(before);
  });

  it('e-posta araması alt çizgiyi literal karakter olarak arar (LIKE joker kaçışı)', async () => {
    const { rewardsAdminService } = await setup({
      users: [
        user({ id: 'u1', email: 'ali_veli@example.com' }),
        user({ id: 'u2', email: 'alixveli@example.com' }),
      ],
      reward_redemptions: [
        redemption({ id: 'r1', user_id: 'u1', idempotency_key: 'k1-000000' }),
        redemption({ id: 'r2', user_id: 'u2', idempotency_key: 'k2-000000' }),
      ],
    });

    const page = await rewardsAdminService.listRedemptions({ status: 'ALL', q: 'ali_veli', page: 1 });
    expect(page.items.map((r) => r.id)).toEqual(['r1']);
  });

  it("e-posta araması kaçışsız joker olarak eşleşmez ('_' ve '%' harflerini içermeyen e-postalarda)", async () => {
    const { rewardsAdminService } = await setup({
      users: [user({ id: 'u1', email: 'ali@example.com' })],
      reward_redemptions: [redemption({ id: 'r1', user_id: 'u1', idempotency_key: 'k1-000000' })],
    });

    expect((await rewardsAdminService.listRedemptions({ status: 'ALL', q: '_', page: 1 })).items).toEqual([]);
    expect((await rewardsAdminService.listRedemptions({ status: 'ALL', q: '%', page: 1 })).items).toEqual([]);
  });

  it('hesabı kalıcı silinmiş talep (user_id null) listede user: null', async () => {
    const { rewardsAdminService } = await setup({ reward_redemptions: [redemption({ user_id: null })] });
    const [row] = (await rewardsAdminService.listRedemptions({ status: 'PENDING', page: 1 })).items;
    expect(row.user).toBeNull();
    expect(row.user_month_total).toBe(0);
  });
});

describe('rewardsAdminService.fulfill', () => {
  it('PENDING → FULFILLED: kod, link, not, karar veren ve zaman yazılır', async () => {
    const { fake, rewardsAdminService } = await setup({ users: [user()], reward_redemptions: [redemption({})] });
    await rewardsAdminService.fulfill('r1', { delivery_code: 'GRAB-1', delivery_url: 'https://g.example/x', admin_note: 'Tremendous #9' }, 'adm1');

    expect(fake.table('reward_redemptions')[0]).toMatchObject({
      status: 'FULFILLED', delivery_code: 'GRAB-1', delivery_url: 'https://g.example/x', admin_note: 'Tremendous #9',
      decided_by: 'adm1', decided_at: NOW.toISOString(),
    });
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it('retten sonra teslim → REWARD_ALREADY_DECIDED', async () => {
    const { rewardsAdminService } = await setup({
      users: [user()],
      reward_redemptions: [redemption({ status: 'REJECTED' })],
    });
    await expect(rewardsAdminService.fulfill('r1', { delivery_code: 'X' }, 'adm1')).rejects.toMatchObject({
      code: 'REWARD_ALREADY_DECIDED',
    });
  });

  it('eşzamanlı karar: okuma PENDING görür ama başka admin önce reddeder → CAS tutmaz, teslim edilmez', async () => {
    const { fake, rewardsAdminService } = await setup(
      { users: [user()], reward_redemptions: [redemption({})] },
      { interleave: [{ table: 'reward_redemptions', mutate: (rows) => { rows[0].status = 'REJECTED'; } }] },
    );
    await expect(rewardsAdminService.fulfill('r1', { delivery_code: 'X' }, 'adm1')).rejects.toMatchObject({
      code: 'REWARD_ALREADY_DECIDED',
    });
    expect(fake.table('reward_redemptions')[0]).toMatchObject({ status: 'REJECTED', delivery_code: null });
  });

  it('olmayan talep → REWARD_REDEMPTION_NOT_FOUND', async () => {
    const { rewardsAdminService } = await setup();
    await expect(rewardsAdminService.fulfill('yok', { delivery_code: 'X' }, 'adm1')).rejects.toMatchObject({
      code: 'REWARD_REDEMPTION_NOT_FOUND',
    });
  });

  it('hesap kalıcı silinmişse teslim edilmez (REWARD_NOT_ELIGIBLE), talep PENDING kalır', async () => {
    const { fake, rewardsAdminService } = await setup({ reward_redemptions: [redemption({ user_id: null })] });
    await expect(rewardsAdminService.fulfill('r1', { delivery_code: 'X' }, 'adm1')).rejects.toMatchObject({
      code: 'REWARD_NOT_ELIGIBLE',
    });
    expect(fake.table('reward_redemptions')[0].status).toBe('PENDING');
  });
});

describe('rewardsAdminService.reject', () => {
  it('PENDING → REJECTED ve rainbow REWARD_REFUND ile iade edilir (talep referansıyla)', async () => {
    const { fake, rewardsAdminService } = await setup({ users: [user()], reward_redemptions: [redemption({})] });
    await rewardsAdminService.reject('r1', 'stok yok', 'adm1');

    expect(fake.table('reward_redemptions')[0]).toMatchObject({
      status: 'REJECTED', reject_reason: 'stok yok', decided_by: 'adm1',
    });
    expect(fake.table('users')[0].rainbow_diamonds).toBe(151);
    expect(fake.table('diamond_transactions')).toEqual([
      expect.objectContaining({ type: 'RAINBOW', amount: 51, reason: 'REWARD_REFUND', reference_id: 'redemption:r1' }),
    ]);
  });

  it('ikinci ret çift iade etmez', async () => {
    const { fake, rewardsAdminService } = await setup({ users: [user()], reward_redemptions: [redemption({})] });
    await rewardsAdminService.reject('r1', 'stok yok', 'adm1');
    await expect(rewardsAdminService.reject('r1', 'stok yok', 'adm1')).rejects.toMatchObject({
      code: 'REWARD_ALREADY_DECIDED',
    });
    expect(fake.table('users')[0].rainbow_diamonds).toBe(151);
    expect(fake.table('diamond_transactions')).toHaveLength(1);
  });

  it('eşzamanlı karar: okuma PENDING görür ama başka admin önce çevirir → CAS tutmaz, iade yok', async () => {
    const { fake, rewardsAdminService } = await setup(
      { users: [user()], reward_redemptions: [redemption({})] },
      { interleave: [{ table: 'reward_redemptions', mutate: (rows) => { rows[0].status = 'FULFILLED'; } }] },
    );
    await expect(rewardsAdminService.reject('r1', 'x', 'adm1')).rejects.toMatchObject({ code: 'REWARD_ALREADY_DECIDED' });
    expect(fake.table('diamond_transactions')).toHaveLength(0);
    expect(fake.table('users')[0].rainbow_diamonds).toBe(100);
  });

  it('hesap kalıcı silinmişse ret yazılır, iade edilecek bakiye yok', async () => {
    const { fake, rewardsAdminService } = await setup({ reward_redemptions: [redemption({ user_id: null })] });
    await rewardsAdminService.reject('r1', 'hesap yok', 'adm1');
    expect(fake.table('reward_redemptions')[0].status).toBe('REJECTED');
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it("iade yazılamazsa talep REJECTED kalır (geri PENDING'e alınmaz) ve REWARD_REFUND_FAILED", async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fake, rewardsAdminService } = await setup(
      { users: [user()], reward_redemptions: [redemption({})] },
      { failOn: [{ table: 'users', op: 'update' }] },
    );
    await expect(rewardsAdminService.reject('r1', 'x', 'adm1')).rejects.toMatchObject({ code: 'REWARD_REFUND_FAILED' });
    expect(fake.table('reward_redemptions')[0].status).toBe('REJECTED');
    errorSpy.mockRestore();
  });

  it('bakiye CAS başarılı ama defter satırı düşmezse: belirsizlik teşhisi loglanır (currentRainbow, refundLedgerRow)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fake, rewardsAdminService } = await setup(
      { users: [user()], reward_redemptions: [redemption({})] },
      { failOn: [{ table: 'diamond_transactions', op: 'insert' }] },
    );
    await expect(rewardsAdminService.reject('r1', 'x', 'adm1')).rejects.toMatchObject({ code: 'REWARD_REFUND_FAILED' });
    expect(fake.table('reward_redemptions')[0].status).toBe('REJECTED');
    // Bakiye CAS'ı (users.update) başarılı oldu — 100 + 51 = 151 — ama defter (diamond_transactions.insert) patladı.
    expect(fake.table('users')[0].rainbow_diamonds).toBe(151);
    expect(fake.table('diamond_transactions')).toHaveLength(0);

    const critical = errorSpy.mock.calls.find((c) => String(c[0]).includes('CRITICAL'));
    expect(critical?.[1]).toMatchObject({ currentRainbow: 151, refundLedgerRow: false });
    errorSpy.mockRestore();
  });
});

describe('rewardsAdminService.getSummary / clearRainbowFlag', () => {
  it('bekleyen, bu ay teslim, dolaşım, tahmini yükümlülük, işaretli kullanıcı', async () => {
    const { rewardsAdminService } = await setup({
      users: [
        user({ rainbow_diamonds: 100, rainbow_flagged_at: '2026-09-25T00:00:00Z' }),
        user({ id: 'u2', rainbow_diamonds: 50 }),
        user({ id: 'u3', rainbow_diamonds: 0 }),
      ],
      reward_redemptions: [
        redemption({ id: 'r1', idempotency_key: 'k1-000000' }),
        redemption({ id: 'r2', status: 'FULFILLED', rainbow_price: 22, decided_at: '2026-09-10T00:00:00Z', idempotency_key: 'k2-000000' }),
        redemption({ id: 'r3', status: 'FULFILLED', rainbow_price: 101, decided_at: '2026-08-20T00:00:00Z', idempotency_key: 'k3-000000' }),
      ],
    });

    expect(await rewardsAdminService.getSummary(0.03)).toEqual({
      pending: 1,
      fulfilledThisMonth: 1,
      rainbowFulfilledThisMonth: 22,
      rainbowInCirculation: 150,
      estimatedLiabilityUsd: 4.5,
      flaggedUsers: 1,
    });
  });

  it('1000 satırda kırpılmaz: 1001 rainbow sahibi kullanıcının hepsi dolaşıma sayılır (fetchAll sayfalama)', async () => {
    const many = Array.from({ length: 1001 }, (_, i) =>
      user({ id: `u${String(i).padStart(4, '0')}`, email: `u${i}@example.com`, rainbow_diamonds: 1 }),
    );
    const { rewardsAdminService } = await setup({ users: many });
    expect((await rewardsAdminService.getSummary(0.03)).rainbowInCirculation).toBe(1001);
  });

  it('uyarı temizlenir; olmayan kullanıcı USER_NOT_FOUND', async () => {
    const { fake, rewardsAdminService } = await setup({ users: [user({ rainbow_flagged_at: '2026-09-25T00:00:00Z' })] });
    await rewardsAdminService.clearRainbowFlag('u1');
    expect(fake.table('users')[0].rainbow_flagged_at).toBeNull();
    await expect(rewardsAdminService.clearRainbowFlag('yok')).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });
});
