import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

const SEED_USER = 'seed-user-1';
const REAL_USER = 'real-user-1';

function seedUser(id: string, isSeed: boolean) {
  return { id, is_seed_profile: isSeed, is_deleted: false, green_diamonds: 0, purple_diamonds: 0 };
}

function reward(id: string, userId: string, amount: number) {
  return {
    id, user_id: userId, type: 'GREEN', amount, reason: 'CHAT_QUESTION_REWARD',
    created_at: new Date().toISOString(),
  };
}

async function setup(users: Record<string, unknown>[], diamond_transactions: Record<string, unknown>[]) {
  const fake = createFakeSupabase({ users, diamond_transactions });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { adminService } = await import('../../src/admin/admin.service.js');
  return adminService;
}

beforeEach(() => vi.resetModules());

describe('getDiamondEconomyStats — seed profillerin sahte kazanci panelde sayilmaz', () => {
  it('seed profilin CHAT_QUESTION_REWARD kazanci greenEarnByReason toplamina hic girmiyor', async () => {
    const svc = await setup(
      [seedUser(SEED_USER, true)],
      [reward('tx1', SEED_USER, 30)],
    );
    const stats = await svc.getDiamondEconomyStats();
    expect(stats.greenEarnByReason.CHAT_QUESTION_REWARD ?? 0).toBe(0);
  });

  it('gercek kullanicinin ayni turdeki kazanci hala sayiliyor', async () => {
    const svc = await setup(
      [seedUser(REAL_USER, false)],
      [reward('tx2', REAL_USER, 15)],
    );
    const stats = await svc.getDiamondEconomyStats();
    expect(stats.greenEarnByReason.CHAT_QUESTION_REWARD).toBe(15);
  });

  it('karisik veride yalniz seed payi dislanir, gercek kullanicininki toplama girer', async () => {
    const svc = await setup(
      [seedUser(SEED_USER, true), seedUser(REAL_USER, false)],
      [reward('tx1', SEED_USER, 30), reward('tx2', REAL_USER, 15)],
    );
    const stats = await svc.getDiamondEconomyStats();
    expect(stats.greenEarnByReason.CHAT_QUESTION_REWARD).toBe(15);
  });
});
