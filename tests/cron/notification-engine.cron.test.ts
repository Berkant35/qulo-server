import { describe, it, expect, vi } from 'vitest';

describe('cron tikleri', () => {
  it('notificationEngineTick: motor patlasa da tik cozulur, runEngine "live" ile cagrilir', async () => {
    vi.resetModules();
    const runEngine = vi.fn().mockResolvedValue({
      runId: 'r1', mode: 'dry_run', enabled: true, tableMissing: false,
      evaluated: 3, outsideWindow: 1, decidedToday: 0, noRule: 1, runCapped: 0, decisions: [],
    });
    vi.doMock('../../src/services/notification-engine/index.js', () => ({
      runEngine,
      summarizeDecisions: () => ({ sent: 0, dry_run: 0, suppressed: 0, holdout: 0, failed: 0 }),
    }));
    const { notificationEngineTick } = await import('../../src/cron/notification-engine.cron.js');

    await expect(notificationEngineTick()).resolves.toBeUndefined();
    expect(runEngine).toHaveBeenCalledWith('live');

    runEngine.mockRejectedValueOnce(new Error('db down'));
    await expect(notificationEngineTick()).resolves.toBeUndefined();
  });

  it('notificationEngineTick: onceki tur bitmeden gelen tik atlanir (overlap yok)', async () => {
    vi.resetModules();
    const done = { runId: 'r', mode: 'dry_run', enabled: true, tableMissing: false, evaluated: 0, outsideWindow: 0, decidedToday: 0, noRule: 0, runCapped: 0, decisions: [] };
    let release!: () => void;
    const runEngine = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(done); })) // ilk tur askida
      .mockResolvedValue(done);
    vi.doMock('../../src/services/notification-engine/index.js', () => ({
      runEngine,
      summarizeDecisions: () => ({ sent: 0, dry_run: 0, suppressed: 0, holdout: 0, failed: 0 }),
    }));
    const { notificationEngineTick } = await import('../../src/cron/notification-engine.cron.js');

    const first = notificationEngineTick();
    await expect(notificationEngineTick()).resolves.toBeUndefined(); // ikinci tik hemen doner
    expect(runEngine).toHaveBeenCalledTimes(1);
    release();
    await first;
    await notificationEngineTick(); // tur bitince tekrar calisir
    expect(runEngine).toHaveBeenCalledTimes(2);
  });

  it('campaignDispatchTick: tek seferlik dispatch patlasa da tekrarlayanlar kosar ve tik cozulur', async () => {
    vi.resetModules();
    const dispatch = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ dispatched: ['c1'], failed: [] });
    const recurring = vi.fn().mockResolvedValueOnce({ campaigns: 1, sent: 1, failed: 0, skipped: {} }).mockRejectedValueOnce(new Error('boom2'));
    vi.doMock('../../src/services/campaign.service.js', () => ({ campaignService: { dispatchDueCampaigns: dispatch } }));
    vi.doMock('../../src/services/campaign-recurring.service.js', () => ({ campaignRecurringService: { dispatch: recurring } }));
    const { campaignDispatchTick } = await import('../../src/cron/campaign-dispatch.cron.js');

    await expect(campaignDispatchTick()).resolves.toBeUndefined();
    await expect(campaignDispatchTick()).resolves.toBeUndefined();
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(recurring).toHaveBeenCalledTimes(2);
  });
});
