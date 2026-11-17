import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

/**
 * Dashboard'daki "Total Users" seed botlarini ve sahibin kendi hesaplarini da sayar.
 * `realUsers` bunlari ayiklar: silinmemis + seed olmayan + e-postasinda "berkant" gecmeyen.
 */
async function setup(users: Record<string, unknown>[]) {
  const fake = createFakeSupabase({ users, matches: [], reports: [], diamond_transactions: [] });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { adminService } = await import('../../src/admin/admin.service.js');
  return adminService;
}

beforeEach(() => vi.resetModules());

describe('getDashboardStats — realUsers', () => {
  it('seed, silinmis ve berkant e-postali hesaplari saymaz', async () => {
    const service = await setup([
      { id: 'r1', email: 'ayse@gmail.com', is_deleted: false, is_seed_profile: false, is_store_bot: false },
      { id: 'r2', email: 'mehmet@icloud.com', is_deleted: false, is_seed_profile: false, is_store_bot: false },
      { id: 's1', email: 'seed1@qulo.test', is_deleted: false, is_seed_profile: true },
      { id: 'b1', email: 'berkantc93@gmail.com', is_deleted: false, is_seed_profile: false, is_store_bot: false },
      { id: 'b2', email: 'BERKANT.test@qulo.app', is_deleted: false, is_seed_profile: false },
      { id: 'd1', email: 'silinen@gmail.com', is_deleted: true, is_seed_profile: false },
    ]);

    const stats = await service.getDashboardStats();

    expect(stats.realUsers).toBe(2);
    expect(stats.totalUsers).toBe(5);
  });

  it('Play on-lansman botlarini (is_store_bot) gercek kullanici ve bugunku kayit saymaz', async () => {
    const today = new Date().toISOString();
    const service = await setup([
      { id: 'r1', email: 'ayse@gmail.com', is_deleted: false, is_seed_profile: false, is_store_bot: false, created_at: today },
      { id: 'p1', email: 'betsyhicks.16617@gmail.com', is_deleted: false, is_seed_profile: false, is_store_bot: true, created_at: today },
      { id: 'p2', email: 'testuser777@example.com', is_deleted: false, is_seed_profile: false, is_store_bot: true, created_at: today },
    ]);

    const stats = await service.getDashboardStats();

    expect(stats.realUsers).toBe(1);
    expect(stats.todayRegistrations).toBe(1);
    // Toplam ham sayi: botlar silinmez, yalniz metrikten ayiklanir.
    expect(stats.totalUsers).toBe(3);
  });
});

