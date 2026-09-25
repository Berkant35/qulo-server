import { describe, it, expect, beforeEach, vi } from 'vitest';

async function setup(opts: { enabled?: boolean; key?: string; ozet?: unknown } = {}) {
  vi.doMock('../../src/config/env.js', () => ({ env: { NVIDIA_API_KEY: opts.key ?? 'nv-key' } }));
  const moderatePendingPhotos = vi.fn(async () => opts.ozet ?? { checked: 0, banned: 0, review: 0, errors: 0 });
  const moderationEnabled = vi.fn(async () => opts.enabled ?? true);
  vi.doMock('../../src/services/photo-moderation.service.js', () => ({ moderatePendingPhotos, moderationEnabled }));
  const mod = await import('../../src/cron/photo-moderation.cron.js');
  return { mod, moderatePendingPhotos };
}

beforeEach(() => vi.resetModules());

describe('photoModerationTick', () => {
  it('kill-switch kapaliyken tarama yapmaz', async () => {
    const { mod, moderatePendingPhotos } = await setup({ enabled: false });
    await mod.photoModerationTick();
    expect(moderatePendingPhotos).not.toHaveBeenCalled();
  });

  it('NVIDIA_API_KEY yoksa tarama yapmaz (bayrak acik olsa da)', async () => {
    const { mod, moderatePendingPhotos } = await setup({ key: '' });
    await mod.photoModerationTick();
    expect(moderatePendingPhotos).not.toHaveBeenCalled();
  });

  it('acikken tik butcesiyle tarar', async () => {
    const { mod, moderatePendingPhotos } = await setup({ ozet: { checked: 3, banned: 1, review: 0, errors: 0 } });
    await mod.photoModerationTick();
    expect(moderatePendingPhotos).toHaveBeenCalledWith(mod.TIK_BUTCESI);
  });

  it('servis hatasi tiki dusurmez, sonraki tik calisir', async () => {
    const { mod, moderatePendingPhotos } = await setup();
    moderatePendingPhotos.mockRejectedValueOnce(new Error('patladi'));
    await expect(mod.photoModerationTick()).resolves.toBeUndefined();
    await mod.photoModerationTick();
    expect(moderatePendingPhotos).toHaveBeenCalledTimes(2);
  });
});

describe('photoModerationCron.start — acilis supurgesi', () => {
  it('start() ACILIS_GECIKMESI_MS sonra bir tik calistirir; stop() iptal eder', async () => {
    vi.useFakeTimers();
    try {
      const { mod, moderatePendingPhotos } = await setup();
      mod.photoModerationCron.start();
      expect(moderatePendingPhotos).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(mod.ACILIS_GECIKMESI_MS);
      expect(moderatePendingPhotos).toHaveBeenCalledTimes(1);
      mod.photoModerationCron.stop();

      vi.resetModules();
      const ikinci = await setup();
      ikinci.mod.photoModerationCron.start();
      ikinci.mod.photoModerationCron.stop();
      await vi.advanceTimersByTimeAsync(ikinci.mod.ACILIS_GECIKMESI_MS);
      expect(ikinci.moderatePendingPhotos).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
