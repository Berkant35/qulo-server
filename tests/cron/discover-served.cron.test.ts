import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

async function setup(purge: () => Promise<number>) {
  const purgeExpired = vi.fn(purge);
  vi.doMock('../../src/services/served-gate.service.js', () => ({ servedGate: { purgeExpired } }));
  const mod = await import('../../src/cron/discover-served.cron.js');
  return { mod, purgeExpired };
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.restoreAllMocks());

describe('discoverServedPurgeTick (gösterim kaydı temizliği, günlük)', () => {
  it('servisin 30 gün temizliğini bir kez çağırır', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { mod, purgeExpired } = await setup(async () => 3);
    await mod.discoverServedPurgeTick();
    expect(purgeExpired).toHaveBeenCalledTimes(1);
  });

  it('hata tiki düşürmez (loglanır, fırlatmaz)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { mod } = await setup(async () => { throw new Error('patladi'); });
    await expect(mod.discoverServedPurgeTick()).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
  });

  it('günde bir kez çalışır (başka günlük temizliklerle çakışmayan dakika)', async () => {
    const { mod } = await setup(async () => 0);
    expect(mod.discoverServedPurgeCron.schedule).toBe('55 3 * * *');
    expect(mod.discoverServedPurgeCron.name).toBe('discover-served-purge');
  });
});
