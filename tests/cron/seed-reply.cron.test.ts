import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

async function setup(enabled: boolean) {
  const fake = createFakeSupabase({ app_config: [{ id: 'cfg', seed_reply_enabled: enabled, seed_reply_fast_mode: false }] });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const scanAndEnqueue = vi.fn(async () => 0);
  const claimDue = vi.fn(async () => []);
  const recoverStale = vi.fn(async () => 0);
  const processRow = vi.fn(async () => 'sent' as const);
  vi.doMock('../../src/services/seed-reply.service.js', () => ({
    scanAndEnqueue, claimDue, recoverStale, processRow,
    askQuestion: vi.fn(), answerQuestionRow: vi.fn(),
  }));
  const mod = await import('../../src/cron/seed-reply.cron.js');
  return { mod, scanAndEnqueue, claimDue, recoverStale };
}

beforeEach(() => vi.resetModules());

describe('seedReplyTick', () => {
  it('kill-switch kapaliyken HICBIR tarama yapmaz', async () => {
    const { mod, scanAndEnqueue, claimDue } = await setup(false);
    await mod.seedReplyTick();
    expect(scanAndEnqueue).not.toHaveBeenCalled();
    expect(claimDue).not.toHaveBeenCalled();
  });

  it('kill-switch acikken kurtarma, tarama ve claim calisir', async () => {
    const { mod, scanAndEnqueue, claimDue, recoverStale } = await setup(true);
    await mod.seedReplyTick();
    expect(recoverStale).toHaveBeenCalled();
    expect(scanAndEnqueue).toHaveBeenCalled();
    expect(claimDue).toHaveBeenCalledWith(expect.any(Number));
  });

  it('cron varsayilan olarak baslamaz (autoStart false)', async () => {
    const { mod } = await setup(true);
    expect(mod.seedReplyCron.autoStart).toBe(false);
    expect(mod.seedReplyCron.schedule).toBe('*/10 * * * * *');
  });
});
