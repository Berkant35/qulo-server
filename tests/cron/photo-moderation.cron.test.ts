import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

async function setup(opts: { enabled?: boolean; key?: string; ozet?: unknown } = {}) {
  const fake = createFakeSupabase({ app_config: [{ id: 'cfg', photo_moderation_enabled: opts.enabled ?? true }] });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  vi.doMock('../../src/config/env.js', () => ({ env: { NVIDIA_API_KEY: opts.key ?? 'nv-key' } }));
  const moderatePendingPhotos = vi.fn(async () => opts.ozet ?? { checked: 0, banned: 0, review: 0, errors: 0 });
  vi.doMock('../../src/services/photo-moderation.service.js', () => ({ moderatePendingPhotos }));
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
