import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';
import type { FakeSupabaseOptions } from '../helpers/fake-supabase.js';

/**
 * Elmas ekonomisinin çekirdeği — ürünün para değen tek yeri.
 * Bakiye/işlem kaydı bellek içi tablolarda tutuluyor, servis gerçek kodun kendisi.
 */
async function setup(seed: Tables, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase(seed, options);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { diamondService } = await import('../../src/services/diamond.service.js');
  return { fake, diamondService };
}

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  green_diamonds: 100,
  purple_diamonds: 50,
  ...over,
});

beforeEach(() => {
  vi.resetModules();
});

describe('DiamondService.getBalance', () => {
  it('kullanıcının iki bakiyesini de döner', async () => {
    const { diamondService } = await setup({ users: [user()] });
    await expect(diamondService.getBalance('u1')).resolves.toEqual({ green: 100, purple: 50 });
  });

  it('kullanıcı yoksa USER_NOT_FOUND', async () => {
    const { diamondService } = await setup({ users: [] });
    await expect(diamondService.getBalance('yok')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
      statusCode: 404,
    });
  });
});

describe('DiamondService.spendGreen', () => {
  it('bakiyeyi düşer ve negatif işlem kaydı yazar', async () => {
    const { fake, diamondService } = await setup({ users: [user({ green_diamonds: 30 })] });

    await expect(diamondService.spendGreen('u1', 30, 'exchange_green_to_purple'))
      .resolves.toEqual({ green: 0 });

    expect(fake.table('users')[0].green_diamonds).toBe(0);
    expect(fake.table('diamond_transactions')).toEqual([
      expect.objectContaining({
        user_id: 'u1',
        type: 'GREEN',
        amount: -30,
        reason: 'exchange_green_to_purple',
        reference_id: null,
      }),
    ]);
  });

  it('referenceId verilirse işlem kaydına yazılır', async () => {
    const { fake, diamondService } = await setup({ users: [user()] });
    await diamondService.spendGreen('u1', 10, 'buy_power_ORACLE', 'power-42');

    expect(fake.table('diamond_transactions')[0].reference_id).toBe('power-42');
  });

  it('bakiye yetersizse reddeder ve hiçbir şeye dokunmaz', async () => {
    const { fake, diamondService } = await setup({ users: [user({ green_diamonds: 5 })] });

    await expect(diamondService.spendGreen('u1', 10, 'test')).rejects.toMatchObject({
      code: 'INSUFFICIENT_DIAMONDS',
      statusCode: 403,
    });

    expect(fake.table('users')[0].green_diamonds).toBe(5);
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it('tam bakiye kadar harcamaya izin verir (sınır)', async () => {
    const { fake, diamondService } = await setup({ users: [user({ green_diamonds: 10 })] });
    await expect(diamondService.spendGreen('u1', 10, 'test')).resolves.toEqual({ green: 0 });
    expect(fake.table('users')[0].green_diamonds).toBe(0);
  });

  it('kullanıcı yoksa USER_NOT_FOUND', async () => {
    const { diamondService } = await setup({ users: [] });
    await expect(diamondService.spendGreen('yok', 1, 'test')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
  });

  it('mor bakiyeye dokunmaz', async () => {
    const { fake, diamondService } = await setup({ users: [user()] });
    await diamondService.spendGreen('u1', 20, 'test');
    expect(fake.table('users')[0].purple_diamonds).toBe(50);
  });
});

describe('DiamondService.spendPurple', () => {
  it('bakiyeyi düşer ve negatif PURPLE kaydı yazar', async () => {
    const { fake, diamondService } = await setup({ users: [user({ purple_diamonds: 15 })] });

    await expect(diamondService.spendPurple('u1', 15, 'buy_power_SHIELD'))
      .resolves.toEqual({ purple: 0 });

    expect(fake.table('users')[0].purple_diamonds).toBe(0);
    expect(fake.table('diamond_transactions')[0]).toMatchObject({ type: 'PURPLE', amount: -15 });
  });

  it('bakiye yetersizse reddeder ve hiçbir şeye dokunmaz', async () => {
    const { fake, diamondService } = await setup({ users: [user({ purple_diamonds: 3 })] });

    await expect(diamondService.spendPurple('u1', 4, 'test')).rejects.toMatchObject({
      code: 'INSUFFICIENT_DIAMONDS',
    });
    expect(fake.table('users')[0].purple_diamonds).toBe(3);
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it('yeşil bakiyeye dokunmaz', async () => {
    const { fake, diamondService } = await setup({ users: [user()] });
    await diamondService.spendPurple('u1', 10, 'test');
    expect(fake.table('users')[0].green_diamonds).toBe(100);
  });
});

describe('DiamondService.addPurple', () => {
  it('bakiyeyi artırır ve pozitif kayıt yazar', async () => {
    const { fake, diamondService } = await setup({ users: [user({ purple_diamonds: 5 })] });

    await expect(diamondService.addPurple('u1', 10, 'exchange_green_to_purple'))
      .resolves.toEqual({ purple: 15 });

    expect(fake.table('users')[0].purple_diamonds).toBe(15);
    expect(fake.table('diamond_transactions')[0]).toMatchObject({ type: 'PURPLE', amount: 10 });
  });

  // Aynı ödülün iki kez verilmesini engelleyen guard — referral/badge akışlarının bel kemiği.
  it('aynı referenceId ile ikinci çağrı ödülü tekrar vermez', async () => {
    const { fake, diamondService } = await setup({ users: [user({ purple_diamonds: 0 })] });

    await diamondService.addPurple('u1', 10, 'referral_reward', 'ref-1');
    await expect(diamondService.addPurple('u1', 10, 'referral_reward', 'ref-1'))
      .resolves.toEqual({ purple: 0 });

    expect(fake.table('users')[0].purple_diamonds).toBe(10);
    expect(fake.table('diamond_transactions')).toHaveLength(1);
  });

  it('farklı referenceId ayrı ödül sayılır', async () => {
    const { fake, diamondService } = await setup({ users: [user({ purple_diamonds: 0 })] });

    await diamondService.addPurple('u1', 10, 'referral_reward', 'ref-1');
    await diamondService.addPurple('u1', 10, 'referral_reward', 'ref-2');

    expect(fake.table('users')[0].purple_diamonds).toBe(20);
    expect(fake.table('diamond_transactions')).toHaveLength(2);
  });

  it('duplicate guard kullanıcı bazlı — başkasının referenceId\'si engellemez', async () => {
    const { fake, diamondService } = await setup({
      users: [user({ id: 'u1', purple_diamonds: 0 }), user({ id: 'u2', purple_diamonds: 0 })],
    });

    await diamondService.addPurple('u1', 10, 'referral_reward', 'ref-1');
    await diamondService.addPurple('u2', 10, 'referral_reward', 'ref-1');

    expect(fake.table('users').find((r) => r.id === 'u2')!.purple_diamonds).toBe(10);
  });

  it('referenceId yoksa duplicate kontrolü yapılmaz', async () => {
    const { fake, diamondService } = await setup({ users: [user({ purple_diamonds: 0 })] });

    await diamondService.addPurple('u1', 5, 'daily_bonus');
    await diamondService.addPurple('u1', 5, 'daily_bonus');

    expect(fake.table('users')[0].purple_diamonds).toBe(10);
  });
});

describe('DiamondService.earnGreen', () => {
  it('bakiyeyi artırır ve pozitif GREEN kaydı yazar', async () => {
    const { fake, diamondService } = await setup({ users: [user({ green_diamonds: 0 })] });

    await expect(diamondService.earnGreen('u1', 25, 'quiz_solved')).resolves.toEqual({ green: 25 });
    expect(fake.table('users')[0].green_diamonds).toBe(25);
    expect(fake.table('diamond_transactions')[0]).toMatchObject({ type: 'GREEN', amount: 25 });
  });

  it('kullanıcı yoksa USER_NOT_FOUND', async () => {
    const { diamondService } = await setup({ users: [] });
    await expect(diamondService.earnGreen('yok', 5, 'test')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
  });
});

describe('DiamondService.getHistory', () => {
  const history = Array.from({ length: 25 }, (_, i) => ({
    id: `t${i}`,
    user_id: 'u1',
    type: 'GREEN',
    amount: i,
    reason: 'test',
    reference_id: null,
    created_at: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
  }));

  it('varsayılan sayfa 20 kayıt döner, toplam sayıyı bildirir', async () => {
    const { diamondService } = await setup({ diamond_transactions: history });
    const result = await diamondService.getHistory('u1');

    expect(result.items).toHaveLength(20);
    expect(result.total).toBe(25);
    expect(result.page).toBe(1);
  });

  it('ikinci sayfa kalanları döner', async () => {
    const { diamondService } = await setup({ diamond_transactions: history });
    const result = await diamondService.getHistory('u1', 2);

    expect(result.items).toHaveLength(5);
    expect(result.page).toBe(2);
  });

  it('en yeni kayıt başta', async () => {
    const { diamondService } = await setup({ diamond_transactions: history });
    const result = await diamondService.getHistory('u1', 1, 3);

    expect(result.items.map((i: any) => i.id)).toEqual(['t24', 't23', 't22']);
  });

  it('başka kullanıcının kayıtlarını sızdırmaz', async () => {
    const { diamondService } = await setup({
      diamond_transactions: [...history, { id: 'x', user_id: 'u2', created_at: '2026-02-01T00:00:00Z' }],
    });
    const result = await diamondService.getHistory('u1', 1, 50);

    expect(result.items).toHaveLength(25);
    expect(result.items.every((i: any) => i.user_id === 'u1')).toBe(true);
  });
});

describe('DiamondService — atomiklik sınırı', () => {
  /**
   * Bilinen davranış, test onu dondurmak için var: bakiye düşümü ile işlem kaydı
   * ayrı iki çağrı. Kayıt yazılamazsa çağıran SERVER_ERROR alır ama elmas ZATEN gitmiştir
   * ve geri alınmaz. Postgres tarafında tek transaction'a alınırsa bu test güncellenmeli.
   */
  it('işlem kaydı yazılamazsa hata verir ama bakiye düşmüş kalır (geri alma yok)', async () => {
    const { fake, diamondService } = await setup(
      { users: [user({ green_diamonds: 100 })] },
      { failOn: [{ table: 'diamond_transactions', op: 'insert' }] },
    );

    await expect(diamondService.spendGreen('u1', 30, 'test')).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      statusCode: 500,
    });

    expect(fake.table('users')[0].green_diamonds).toBe(70);
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });
});
