import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * `initCrons()`'un `autoStart === false` filtresi MEVCUT alti cron'u koruyor:
 * filtre yanlislikla falsy kontrolune donerse (`!job.autoStart`) hicbiri sessizce
 * baslamaz ve bu uretimde ancak "neden hicbir sey calismiyor" diye fark edilir.
 */
function sahteIs(name: string, over: Record<string, unknown> = {}) {
  return {
    name, description: `${name} isi`, schedule: '* * * * *', running: false,
    start: vi.fn(), stop: vi.fn(), ...over,
  };
}

async function setup(seedOver: Record<string, unknown> = {}) {
  const isler = {
    presenceCron: sahteIs('presence'),
    analyticsAggregateCron: sahteIs('analytics-aggregate'),
    analyticsCleanupCron: sahteIs('analytics-cleanup'),
    notificationEngineCron: sahteIs('notification-engine'),
    campaignDispatchCron: sahteIs('campaign-dispatch'),
    webQuizPurgeCron: sahteIs('web-quiz-purge'),
    seedReplyCron: sahteIs('seed-reply', { autoStart: false, ...seedOver }),
  };

  vi.doMock('../../src/cron/presence.cron.js', () => ({ presenceCron: isler.presenceCron }));
  vi.doMock('../../src/cron/analytics.cron.js', () => ({
    analyticsAggregateCron: isler.analyticsAggregateCron,
    analyticsCleanupCron: isler.analyticsCleanupCron,
  }));
  vi.doMock('../../src/cron/notification-engine.cron.js', () => ({ notificationEngineCron: isler.notificationEngineCron }));
  vi.doMock('../../src/cron/campaign-dispatch.cron.js', () => ({ campaignDispatchCron: isler.campaignDispatchCron }));
  vi.doMock('../../src/cron/web-quiz.cron.js', () => ({ webQuizPurgeCron: isler.webQuizPurgeCron }));
  vi.doMock('../../src/cron/seed-reply.cron.js', () => ({ seedReplyCron: isler.seedReplyCron }));

  const mod = await import('../../src/cron/index.js');
  return { mod, isler };
}

const digerleri = (isler: Record<string, { start: ReturnType<typeof vi.fn> }>) =>
  Object.entries(isler).filter(([ad]) => ad !== 'seedReplyCron').map(([, is]) => is);

beforeEach(() => vi.resetModules());

describe('initCrons', () => {
  it('autoStart=false olan isi BASLATMAZ, diger alti isi baslatir', async () => {
    const { mod, isler } = await setup();
    mod.initCrons();

    expect(isler.seedReplyCron.start).not.toHaveBeenCalled();
    for (const is of digerleri(isler)) expect(is.start).toHaveBeenCalledTimes(1);
  });

  it('autoStart belirtilmemis is baslatilir — filtre yalnizca === false ile eler', async () => {
    // Filtre falsy'ye donerse (`!job.autoStart`) bu is de sessizce baslamaz.
    const { mod, isler } = await setup({ autoStart: undefined });
    mod.initCrons();

    expect(isler.seedReplyCron.start).toHaveBeenCalledTimes(1);
    for (const is of digerleri(isler)) expect(is.start).toHaveBeenCalledTimes(1);
  });

  it('baslatilmayan is listede KALIR: toggleCronJob onu bulup baslatabilir', async () => {
    const { mod, isler } = await setup();
    mod.initCrons();

    expect(mod.getCronJobs().map((j) => j.name)).toContain('seed-reply');
    expect(mod.toggleCronJob('seed-reply', 'start')).toBe(true);
    expect(isler.seedReplyCron.start).toHaveBeenCalledTimes(1);
  });
});
