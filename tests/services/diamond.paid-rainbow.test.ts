import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';

/**
 * Ödenmiş mor sayacı + Rainbow. Para güvenliği: bedava mor asla rainbow üretmemeli,
 * sayaç asla bakiyeyi aşmamalı, eşzamanlı yazımda güncelleme kaybolmamalı.
 */
async function setup(seed: Tables, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase(seed, options);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { diamondService } = await import('../../src/services/diamond.service.js');
  return { fake, diamondService };
}

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1', green_diamonds: 0, purple_diamonds: 100, purple_paid: 0, rainbow_diamonds: 0, ...over,
});

beforeEach(() => {
  vi.resetModules();
});

describe('spendPurple — önce ödenmiş', () => {
  it('ödenmiş sayaçtan önce düşer ve paidUsed döner', async () => {
    const { fake, diamondService } = await setup({ users: [user({ purple_paid: 30 })] });
    await expect(diamondService.spendPurple('u1', 20, 'POWER_USED:HALF', 's1'))
      .resolves.toEqual({ purple: 80, paidUsed: 20 });
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 80, purple_paid: 10 });
    expect(fake.table('diamond_transactions')[0]).toMatchObject({ type: 'PURPLE', amount: -20, paid_amount: 20 });
  });

  it('ödenmiş sayaç yetmezse kalanı bedavadan düşer', async () => {
    const { fake, diamondService } = await setup({ users: [user({ purple_paid: 5 })] });
    await expect(diamondService.spendPurple('u1', 20, 'x')).resolves.toEqual({ purple: 80, paidUsed: 5 });
    expect(fake.table('users')[0].purple_paid).toBe(0);
  });

  it('ödenmiş yoksa paidUsed 0 ve defter satırında paid_amount yazılmaz', async () => {
    const { fake, diamondService } = await setup({ users: [user()] });
    await expect(diamondService.spendPurple('u1', 20, 'x')).resolves.toEqual({ purple: 80, paidUsed: 0 });
    expect(fake.table('diamond_transactions')[0].paid_amount).toBeUndefined();
  });

  it('yetersiz bakiye hiçbir şeye dokunmaz', async () => {
    const { fake, diamondService } = await setup({ users: [user({ purple_diamonds: 10, purple_paid: 10 })] });
    await expect(diamondService.spendPurple('u1', 20, 'x')).rejects.toMatchObject({ code: 'INSUFFICIENT_DIAMONDS' });
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 10, purple_paid: 10 });
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it('okuma ile yazma arasına giren kredi kaybolmaz (CAS yeniden dener)', async () => {
    const { fake, diamondService } = await setup(
      { users: [user({ purple_paid: 0 })] },
      { interleave: [{ table: 'users', mutate: (rows) => { rows[0].purple_diamonds += 50; rows[0].purple_paid += 50; } }] },
    );
    await expect(diamondService.spendPurple('u1', 20, 'x')).resolves.toEqual({ purple: 130, paidUsed: 20 });
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 130, purple_paid: 30 });
  });

  it('ABA: araya giren ödenmiş harcama + bedava kredi ödenmiş sayacı şişiremez', async () => {
    const { fake, diamondService } = await setup(
      { users: [user({ purple_diamonds: 100, purple_paid: 30 })] },
      { interleave: [{ table: 'users', mutate: (rows) => { rows[0].purple_diamonds = 100; rows[0].purple_paid = 0; } }] },
    );
    await expect(diamondService.spendPurple('u1', 10, 'x')).resolves.toEqual({ purple: 90, paidUsed: 0 });
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 90, purple_paid: 0 });
  });
});

describe('addPurple — ödenmiş pay', () => {
  it('paidAmount sayaca eklenir ve defter satırına yazılır', async () => {
    const { fake, diamondService } = await setup({ users: [user({ purple_diamonds: 0 })] });
    await expect(diamondService.addPurple('u1', 50, 'IAP_PURCHASE', 'tx-1', 50))
      .resolves.toEqual({ purple: 50, credited: 50 });
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 50, purple_paid: 50 });
    expect(fake.table('diamond_transactions')[0]).toMatchObject({ amount: 50, paid_amount: 50 });
  });

  it('paidAmount verilmezse bedava (sayaç değişmez)', async () => {
    const { fake, diamondService } = await setup({ users: [user({ purple_diamonds: 0 })] });
    await diamondService.addPurple('u1', 100, 'PROFILE_COMPLETION', 'milestone_100');
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 100, purple_paid: 0 });
  });

  it('paidAmount tutarı aşamaz', async () => {
    const { fake, diamondService } = await setup({ users: [user({ purple_diamonds: 0 })] });
    await diamondService.addPurple('u1', 10, 'IAP_PURCHASE', 'tx-2', 999);
    expect(fake.table('users')[0].purple_paid).toBe(10);
  });

  it('duplicate referans ikinci kez ne bakiye ne sayaç yazar', async () => {
    const { fake, diamondService } = await setup({ users: [user({ purple_diamonds: 0 })] });
    await diamondService.addPurple('u1', 50, 'IAP_PURCHASE', 'tx-3', 50);
    await expect(diamondService.addPurple('u1', 50, 'IAP_PURCHASE', 'tx-3', 50))
      .resolves.toEqual({ purple: 50, credited: 0 });
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 50, purple_paid: 50 });
  });
});

describe('Rainbow bakiyesi', () => {
  it('earnRainbow artırır ve RAINBOW satırı yazar', async () => {
    const { fake, diamondService } = await setup({ users: [user()] });
    await expect(diamondService.earnRainbow('u1', 6, 'POWER_REWARD:HALF', 's1')).resolves.toEqual({ rainbow: 6 });
    expect(fake.table('diamond_transactions')[0]).toMatchObject({ type: 'RAINBOW', amount: 6, reason: 'POWER_REWARD:HALF' });
  });

  it('spendRainbow düşer; yetersizse reddeder', async () => {
    const { fake, diamondService } = await setup({ users: [user({ rainbow_diamonds: 10 })] });
    await expect(diamondService.spendRainbow('u1', 4, 'buy_power_HALF')).resolves.toEqual({ rainbow: 6 });
    await expect(diamondService.spendRainbow('u1', 7, 'x')).rejects.toMatchObject({ code: 'INSUFFICIENT_DIAMONDS' });
    expect(fake.table('users')[0].rainbow_diamonds).toBe(6);
  });

  it('eşzamanlı iki kazanım: ikincisi kaybolmaz', async () => {
    const { fake, diamondService } = await setup(
      { users: [user({ rainbow_diamonds: 0 })] },
      { interleave: [{ table: 'users', mutate: (rows) => { rows[0].rainbow_diamonds += 3; } }] },
    );
    await diamondService.earnRainbow('u1', 6, 'x');
    expect(fake.table('users')[0].rainbow_diamonds).toBe(9);
  });

  it('getBalance üç bakiyeyi döner', async () => {
    const { diamondService } = await setup({ users: [user({ green_diamonds: 7, rainbow_diamonds: 3 })] });
    await expect(diamondService.getBalance('u1')).resolves.toEqual({ green: 7, purple: 100, rainbow: 3 });
  });
});

describe('creditReward — bölünmüş ödül', () => {
  it('iki pay da varsa iki satır yazar', async () => {
    const { fake, diamondService } = await setup({ users: [user()] });
    await diamondService.creditReward('u1', { green: 30, rainbow: 6 }, 'POWER_REWARD:SKIP', 's1');
    expect(fake.table('users')[0]).toMatchObject({ green_diamonds: 30, rainbow_diamonds: 6 });
    expect(fake.table('diamond_transactions').map((t) => [t.type, t.amount])).toEqual([['GREEN', 30], ['RAINBOW', 6]]);
  });

  it('sıfır olan pay için satır yazmaz', async () => {
    const { fake, diamondService } = await setup({ users: [user()] });
    await diamondService.creditReward('u1', { green: 3, rainbow: 0 }, 'x');
    expect(fake.table('diamond_transactions')).toHaveLength(1);
    expect(fake.table('diamond_transactions')[0].type).toBe('GREEN');
  });
});
