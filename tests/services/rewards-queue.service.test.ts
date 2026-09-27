import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';
import { redemptionReference, REWARD_REFUND_REASON } from '../../src/utils/rewards.js';

const NOW = new Date('2026-09-27T12:00:00Z');

async function setup(seed: Tables = {}, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase(
    { reward_redemptions: [], diamond_transactions: [], users: [], ...seed },
    options,
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { rewardsQueueService } = await import('../../src/services/rewards-queue.service.js');
  return { fake, rewardsQueueService };
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
  // Konsol casusları test ortasında patlasa da sızmasın.
  vi.restoreAllMocks();
});

describe('rewardsQueueService.listRedemptions', () => {
  it('varsayılan PENDING, en eski önce; kod maskeli; kullanıcı + uyarı + bu ay toplamı eklenir', async () => {
    const { rewardsQueueService } = await setup({
      users: [user({ rainbow_flagged_at: '2026-09-25T00:00:00Z' }), user({ id: 'u2', email: 'ayse@example.com', country: 'ID' })],
      reward_redemptions: [
        redemption({ id: 'r-new', created_at: '2026-09-22T00:00:00Z', idempotency_key: 'k1-000000' }),
        redemption({ id: 'r-old', user_id: 'u2', created_at: '2026-09-21T00:00:00Z', idempotency_key: 'k2-000000' }),
        redemption({ id: 'r-done', status: 'FULFILLED', rainbow_price: 22, delivery_code: 'GRAB-ABCD-1234', created_at: '2026-09-05T00:00:00Z', idempotency_key: 'k3-000000' }),
        redemption({ id: 'r-last-month', status: 'FULFILLED', rainbow_price: 101, created_at: '2026-08-30T00:00:00Z', idempotency_key: 'k4-000000' }),
      ],
    });

    const page = await rewardsQueueService.listRedemptions({ status: 'PENDING', page: 1 });

    expect(page.items.map((r) => r.id)).toEqual(['r-old', 'r-new']);
    expect(page.total).toBe(2);
    const rNew = page.items[1];
    expect(rNew.user).toMatchObject({ id: 'u1', email: 'ali@example.com', country: 'TH', rainbow_flagged_at: '2026-09-25T00:00:00Z' });
    expect(rNew.user_month_total).toBe(73);
    expect(rNew).not.toHaveProperty('delivery_code');
  });

  it('sonuçlananlar en yeni önce; teslim kodu ve linki yalnız maskeli/host olarak döner', async () => {
    const { rewardsQueueService } = await setup({
      users: [user()],
      reward_redemptions: [
        redemption({
          id: 'r-a', status: 'FULFILLED', delivery_code: 'GRAB-ABCD-1234',
          delivery_url: 'https://g.example/claim/SECRET123', created_at: '2026-09-05T00:00:00Z', idempotency_key: 'k1-000000',
        }),
        redemption({ id: 'r-b', status: 'REJECTED', reject_reason: 'stok yok', created_at: '2026-09-06T00:00:00Z', idempotency_key: 'k2-000000' }),
      ],
    });

    const page = await rewardsQueueService.listRedemptions({ status: 'ALL', page: 1 });
    expect(page.items.map((r) => r.id)).toEqual(['r-b', 'r-a']);
    expect(page.items[1].masked_code).toBe('••••1234');
    expect(page.items[1].delivery_host).toBe('g.example');
    expect(page.items[1]).not.toHaveProperty('delivery_url');
    expect(JSON.stringify(page)).not.toContain('GRAB-ABCD-1234');
    expect(JSON.stringify(page)).not.toContain('SECRET123');
  });

  it('e-posta araması ve ülke filtresi; eşleşme yoksa talep sorgusu atılmaz', async () => {
    const { fake, rewardsQueueService } = await setup({
      users: [user(), user({ id: 'u2', email: 'ayse@example.com' })],
      reward_redemptions: [
        redemption({ id: 'r1', idempotency_key: 'k1-000000' }),
        redemption({ id: 'r2', user_id: 'u2', country_code: 'ID', idempotency_key: 'k2-000000' }),
      ],
    });

    expect((await rewardsQueueService.listRedemptions({ status: 'ALL', q: 'ayse', page: 1 })).items.map((r) => r.id)).toEqual(['r2']);
    expect((await rewardsQueueService.listRedemptions({ status: 'ALL', country: 'TH', page: 1 })).items.map((r) => r.id)).toEqual(['r1']);

    // '_' kaçışsız bırakılsaydı (eski davranış: joker karakterleri silme) tek-karakter jokeri
    // olarak HER e-postaya uyar, eşleşme bulunur ve talep sorgusu atılırdı — bu yüzden bu
    // olmadan da yeşil kalan zayıf bir "hiç eşleşme yok" iddiası değil, kaçışın kendisi sınanıyor.
    const before = fake.queries.filter((q) => q.table === 'reward_redemptions').length;
    const none = await rewardsQueueService.listRedemptions({ status: 'ALL', q: '_', page: 1 });
    expect(none).toEqual({ items: [], total: 0, page: 1, pageSize: 30 });
    expect(fake.queries.filter((q) => q.table === 'reward_redemptions').length).toBe(before);
  });

  it('e-posta araması alt çizgiyi literal karakter olarak arar (LIKE joker kaçışı)', async () => {
    const { rewardsQueueService } = await setup({
      users: [
        user({ id: 'u1', email: 'ali_veli@example.com' }),
        user({ id: 'u2', email: 'alixveli@example.com' }),
      ],
      reward_redemptions: [
        redemption({ id: 'r1', user_id: 'u1', idempotency_key: 'k1-000000' }),
        redemption({ id: 'r2', user_id: 'u2', idempotency_key: 'k2-000000' }),
      ],
    });

    const page = await rewardsQueueService.listRedemptions({ status: 'ALL', q: 'ali_veli', page: 1 });
    expect(page.items.map((r) => r.id)).toEqual(['r1']);
  });

  it("e-posta araması kaçışsız joker olarak eşleşmez ('_' ve '%' harflerini içermeyen e-postalarda)", async () => {
    const { rewardsQueueService } = await setup({
      users: [user({ id: 'u1', email: 'ali@example.com' })],
      reward_redemptions: [redemption({ id: 'r1', user_id: 'u1', idempotency_key: 'k1-000000' })],
    });

    expect((await rewardsQueueService.listRedemptions({ status: 'ALL', q: '_', page: 1 })).items).toEqual([]);
    expect((await rewardsQueueService.listRedemptions({ status: 'ALL', q: '%', page: 1 })).items).toEqual([]);
  });

  it('kullanıcı filtresi (kullanıcı detayından): yalnız o kullanıcının talepleri', async () => {
    const { rewardsQueueService } = await setup({
      users: [user(), user({ id: 'u2', email: 'ayse@example.com' })],
      reward_redemptions: [
        redemption({ id: 'r1', idempotency_key: 'k1-000000' }),
        redemption({ id: 'r2', user_id: 'u2', idempotency_key: 'k2-000000' }),
      ],
    });
    const page = await rewardsQueueService.listRedemptions({ status: 'ALL', user: 'u2', page: 1 });
    expect(page.items.map((r) => r.id)).toEqual(['r2']);
    expect(page.total).toBe(1);
  });

  it('aynı anda açılan talepler id ile kararlı sıralanır (sayfa sınırında kayma/tekrar yok)', async () => {
    const { rewardsQueueService } = await setup({
      users: [user()],
      reward_redemptions: [
        redemption({ id: 'r-b', created_at: '2026-09-20T00:00:00Z', idempotency_key: 'k1-000000' }),
        redemption({ id: 'r-a', created_at: '2026-09-20T00:00:00Z', idempotency_key: 'k2-000000' }),
      ],
    });
    const page = await rewardsQueueService.listRedemptions({ status: 'PENDING', page: 1 });
    expect(page.items.map((r) => r.id)).toEqual(['r-a', 'r-b']);
  });

  it('bu ay toplamı yalnız PENDING + FULFILLED: aynı ayki REJECTED talep (iade edildi) sayılmaz', async () => {
    const { rewardsQueueService } = await setup({
      users: [user()],
      reward_redemptions: [
        redemption({ id: 'r1', idempotency_key: 'k1-000000' }),
        redemption({ id: 'r-rej', status: 'REJECTED', rainbow_price: 100, created_at: '2026-09-15T00:00:00Z', idempotency_key: 'k2-000000' }),
      ],
    });
    const [row] = (await rewardsQueueService.listRedemptions({ status: 'PENDING', page: 1 })).items;
    expect(row.user_month_total).toBe(51);
  });

  it('hesabı kalıcı silinmiş talep (user_id null) listede user: null', async () => {
    const { rewardsQueueService } = await setup({ reward_redemptions: [redemption({ user_id: null })] });
    const [row] = (await rewardsQueueService.listRedemptions({ status: 'PENDING', page: 1 })).items;
    expect(row.user).toBeNull();
    expect(row.user_month_total).toBe(0);
  });
});

describe('rewardsQueueService.fulfill', () => {
  it('PENDING → FULFILLED: kod, link, not, karar veren ve zaman yazılır', async () => {
    const { fake, rewardsQueueService } = await setup({ users: [user()], reward_redemptions: [redemption({})] });
    await rewardsQueueService.fulfill('r1', { delivery_code: 'GRAB-1', delivery_url: 'https://g.example/x', admin_note: 'Tremendous #9' }, 'adm1');

    expect(fake.table('reward_redemptions')[0]).toMatchObject({
      status: 'FULFILLED', delivery_code: 'GRAB-1', delivery_url: 'https://g.example/x', admin_note: 'Tremendous #9',
      decided_by: 'adm1', decided_at: NOW.toISOString(),
    });
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it('retten sonra teslim → REWARD_ALREADY_DECIDED', async () => {
    const { rewardsQueueService } = await setup({
      users: [user()],
      reward_redemptions: [redemption({ status: 'REJECTED' })],
    });
    await expect(rewardsQueueService.fulfill('r1', { delivery_code: 'X' }, 'adm1')).rejects.toMatchObject({
      code: 'REWARD_ALREADY_DECIDED',
    });
  });

  it('eşzamanlı karar: okuma PENDING görür ama başka admin önce reddeder → CAS tutmaz, teslim edilmez', async () => {
    const { fake, rewardsQueueService } = await setup(
      { users: [user()], reward_redemptions: [redemption({})] },
      { interleave: [{ table: 'reward_redemptions', mutate: (rows) => { rows[0].status = 'REJECTED'; } }] },
    );
    await expect(rewardsQueueService.fulfill('r1', { delivery_code: 'X' }, 'adm1')).rejects.toMatchObject({
      code: 'REWARD_ALREADY_DECIDED',
    });
    expect(fake.table('reward_redemptions')[0]).toMatchObject({ status: 'REJECTED', delivery_code: null });
  });

  it('olmayan talep → REWARD_REDEMPTION_NOT_FOUND', async () => {
    const { rewardsQueueService } = await setup();
    await expect(rewardsQueueService.fulfill('yok', { delivery_code: 'X' }, 'adm1')).rejects.toMatchObject({
      code: 'REWARD_REDEMPTION_NOT_FOUND',
    });
  });

  it('hesap kalıcı silinmişse teslim edilmez (REWARD_ACCOUNT_PURGED), talep PENDING kalır', async () => {
    const { fake, rewardsQueueService } = await setup({ reward_redemptions: [redemption({ user_id: null })] });
    await expect(rewardsQueueService.fulfill('r1', { delivery_code: 'X' }, 'adm1')).rejects.toMatchObject({
      code: 'REWARD_ACCOUNT_PURGED',
    });
    expect(fake.table('reward_redemptions')[0].status).toBe('PENDING');
  });

  it('hesap okuma ile yazma arasında kalıcı silinirse CAS tutmaz: kod yazılmaz, talep PENDING kalır', async () => {
    const { fake, rewardsQueueService } = await setup(
      { users: [user()], reward_redemptions: [redemption({})] },
      { interleave: [{ table: 'reward_redemptions', mutate: (rows) => { rows[0].user_id = null; } }] },
    );
    await expect(rewardsQueueService.fulfill('r1', { delivery_code: 'X' }, 'adm1')).rejects.toMatchObject({
      code: 'REWARD_ALREADY_DECIDED',
    });
    expect(fake.table('reward_redemptions')[0]).toMatchObject({ status: 'PENDING', delivery_code: null });
  });

  it('talebin rainbow’u zaten iade edilmişse (itfa telafisi REWARD_REFUND yazmış) teslim edilmez: REWARD_ALREADY_REFUNDED', async () => {
    const { fake, rewardsQueueService } = await setup({
      users: [user()],
      reward_redemptions: [redemption({})],
      diamond_transactions: [
        { id: 'd-refund', user_id: 'u1', type: 'RAINBOW', amount: 51, reason: REWARD_REFUND_REASON, reference_id: redemptionReference('r1') },
      ],
    });
    await expect(rewardsQueueService.fulfill('r1', { delivery_code: 'GRAB-1' }, 'adm1')).rejects.toMatchObject({
      code: 'REWARD_ALREADY_REFUNDED',
    });
    expect(fake.table('reward_redemptions')[0]).toMatchObject({ status: 'PENDING', delivery_code: null });
  });

  it('iade satırı okunamazsa teslim edilmez (kapalı kalır): SERVER_ERROR, talep PENDING', async () => {
    const { fake, rewardsQueueService } = await setup(
      { users: [user()], reward_redemptions: [redemption({})] },
      { failOn: [{ table: 'diamond_transactions', op: 'select' }] },
    );
    await expect(rewardsQueueService.fulfill('r1', { delivery_code: 'GRAB-1' }, 'adm1')).rejects.toMatchObject({
      code: 'SERVER_ERROR',
    });
    expect(fake.table('reward_redemptions')[0]).toMatchObject({ status: 'PENDING', delivery_code: null });
  });
});

describe('rewardsQueueService.reject', () => {
  it('PENDING → REJECTED ve rainbow REWARD_REFUND ile iade edilir (talep referansıyla)', async () => {
    const { fake, rewardsQueueService } = await setup({ users: [user()], reward_redemptions: [redemption({})] });
    await expect(rewardsQueueService.reject('r1', 'stok yok', 'adm1')).resolves.toEqual({ refunded: true });

    expect(fake.table('reward_redemptions')[0]).toMatchObject({
      status: 'REJECTED', reject_reason: 'stok yok', decided_by: 'adm1',
    });
    expect(fake.table('users')[0].rainbow_diamonds).toBe(151);
    expect(fake.table('diamond_transactions')).toEqual([
      expect.objectContaining({ type: 'RAINBOW', amount: 51, reason: REWARD_REFUND_REASON, reference_id: redemptionReference('r1') }),
    ]);
  });

  it('ikinci ret çift iade etmez', async () => {
    const { fake, rewardsQueueService } = await setup({ users: [user()], reward_redemptions: [redemption({})] });
    await rewardsQueueService.reject('r1', 'stok yok', 'adm1');
    await expect(rewardsQueueService.reject('r1', 'stok yok', 'adm1')).rejects.toMatchObject({
      code: 'REWARD_ALREADY_DECIDED',
    });
    expect(fake.table('users')[0].rainbow_diamonds).toBe(151);
    expect(fake.table('diamond_transactions')).toHaveLength(1);
  });

  it('eşzamanlı karar: okuma PENDING görür ama başka admin önce çevirir → CAS tutmaz, iade yok', async () => {
    const { fake, rewardsQueueService } = await setup(
      { users: [user()], reward_redemptions: [redemption({})] },
      { interleave: [{ table: 'reward_redemptions', mutate: (rows) => { rows[0].status = 'FULFILLED'; } }] },
    );
    await expect(rewardsQueueService.reject('r1', 'x', 'adm1')).rejects.toMatchObject({ code: 'REWARD_ALREADY_DECIDED' });
    expect(fake.table('diamond_transactions')).toHaveLength(0);
    expect(fake.table('users')[0].rainbow_diamonds).toBe(100);
  });

  it('hesap kalıcı silinmişse ret yazılır, iade edilecek bakiye yok (refunded: false)', async () => {
    const { fake, rewardsQueueService } = await setup({ reward_redemptions: [redemption({ user_id: null })] });
    await expect(rewardsQueueService.reject('r1', 'hesap yok', 'adm1')).resolves.toEqual({ refunded: false });
    expect(fake.table('reward_redemptions')[0].status).toBe('REJECTED');
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it('rainbow zaten iade edilmişse (itfa telafisi): talep REJECTED olur, ikinci iade YOK (refunded: false)', async () => {
    const { fake, rewardsQueueService } = await setup({
      users: [user()],
      reward_redemptions: [redemption({})],
      diamond_transactions: [
        { id: 'd-refund', user_id: 'u1', type: 'RAINBOW', amount: 51, reason: REWARD_REFUND_REASON, reference_id: redemptionReference('r1') },
      ],
    });
    await expect(rewardsQueueService.reject('r1', 'x', 'adm1')).resolves.toEqual({ refunded: false });
    expect(fake.table('reward_redemptions')[0].status).toBe('REJECTED');
    expect(fake.table('users')[0].rainbow_diamonds).toBe(100);
    expect(fake.table('diamond_transactions').map((t) => t.id)).toEqual(['d-refund']);
  });

  it("iade yazılamazsa talep REJECTED kalır (geri PENDING'e alınmaz) ve REWARD_REFUND_FAILED", async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fake, rewardsQueueService } = await setup(
      { users: [user()], reward_redemptions: [redemption({})] },
      { failOn: [{ table: 'users', op: 'update' }] },
    );
    await expect(rewardsQueueService.reject('r1', 'x', 'adm1')).rejects.toMatchObject({ code: 'REWARD_REFUND_FAILED' });
    expect(fake.table('reward_redemptions')[0].status).toBe('REJECTED');
    errorSpy.mockRestore();
  });

  it('bakiye CAS başarılı ama defter satırı düşmezse: belirsizlik teşhisi loglanır (currentRainbow, refundLedgerRow)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fake, rewardsQueueService } = await setup(
      { users: [user()], reward_redemptions: [redemption({})] },
      { failOn: [{ table: 'diamond_transactions', op: 'insert' }] },
    );
    await expect(rewardsQueueService.reject('r1', 'x', 'adm1')).rejects.toMatchObject({ code: 'REWARD_REFUND_FAILED' });
    expect(fake.table('reward_redemptions')[0].status).toBe('REJECTED');
    // Bakiye CAS'ı (users.update) başarılı oldu — 100 + 51 = 151 — ama defter (diamond_transactions.insert) patladı.
    expect(fake.table('users')[0].rainbow_diamonds).toBe(151);
    expect(fake.table('diamond_transactions')).toHaveLength(0);

    const critical = errorSpy.mock.calls.find((c) => String(c[0]).includes('CRITICAL'));
    expect(critical?.[1]).toMatchObject({ currentRainbow: 151, refundLedgerRow: false });
    errorSpy.mockRestore();
  });
});

describe('rewardsQueueService.getSummary / clearRainbowFlag', () => {
  it('bekleyen, bu ay teslim, dolaşım, tahmini yükümlülük, işaretli kullanıcı', async () => {
    const { rewardsQueueService } = await setup({
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

    expect(await rewardsQueueService.getSummary(0.03)).toEqual({
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
    // maxRows: PostgREST gibi sayfasız okuma 1000'de kesilir — sayfalamayan sorgu burada 1000 görürdü.
    const { rewardsQueueService } = await setup({ users: many }, { maxRows: 1000 });
    expect((await rewardsQueueService.getSummary(0.03)).rainbowInCirculation).toBe(1001);
  });

  it('özet gerçek kullanıcıyı ölçer: seed ve test hesabının rainbow’u dolaşıma, test talepleri bekleyen/teslim sayısına girmez', async () => {
    const { rewardsQueueService } = await setup({
      users: [
        user({ rainbow_diamonds: 100 }),
        user({ id: 'u-seed', rainbow_diamonds: 500, is_seed_profile: true }),
        user({ id: 'u-test', rainbow_diamonds: 70, is_test_account: true }),
      ],
      reward_redemptions: [
        redemption({ id: 'r1', idempotency_key: 'k1-000000' }),
        redemption({ id: 'r-test-pending', is_test: true, idempotency_key: 'k2-000000' }),
        redemption({ id: 'r2', status: 'FULFILLED', rainbow_price: 22, decided_at: '2026-09-10T00:00:00Z', idempotency_key: 'k3-000000' }),
        redemption({ id: 'r-test-done', status: 'FULFILLED', is_test: true, rainbow_price: 101, decided_at: '2026-09-11T00:00:00Z', idempotency_key: 'k4-000000' }),
      ],
    });

    expect(await rewardsQueueService.getSummary(0.03)).toMatchObject({
      pending: 1,
      fulfilledThisMonth: 1,
      rainbowFulfilledThisMonth: 22,
      rainbowInCirculation: 100,
      estimatedLiabilityUsd: 3,
    });
  });

  it('uyarı temizlenir; olmayan kullanıcı USER_NOT_FOUND', async () => {
    const { fake, rewardsQueueService } = await setup({ users: [user({ rainbow_flagged_at: '2026-09-25T00:00:00Z' })] });
    await rewardsQueueService.clearRainbowFlag('u1');
    expect(fake.table('users')[0].rainbow_flagged_at).toBeNull();
    await expect(rewardsQueueService.clearRainbowFlag('yok')).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });
});
