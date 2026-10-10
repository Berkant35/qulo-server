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
      { id: 'r1', email: 'ayse@gmail.com', is_deleted: false, is_seed_profile: false },
      { id: 'r2', email: 'mehmet@icloud.com', is_deleted: false, is_seed_profile: false },
      { id: 's1', email: 'seed1@qulo.test', is_deleted: false, is_seed_profile: true },
      { id: 'b1', email: 'berkantc93@gmail.com', is_deleted: false, is_seed_profile: false },
      { id: 'b2', email: 'BERKANT.test@qulo.app', is_deleted: false, is_seed_profile: false },
      { id: 'd1', email: 'silinen@gmail.com', is_deleted: true, is_seed_profile: false },
    ]);

    const stats = await service.getDashboardStats();

    expect(stats.realUsers).toBe(2);
    expect(stats.totalUsers).toBe(5);
  });
});
