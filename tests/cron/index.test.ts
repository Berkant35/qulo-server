import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * initCrons() KAYITLI HER isi baslatir. Seed AI cevaplarinin kapisi surec ici
 * start/stop degil, app_config.seed_reply_enabled bayragidir (her tikta okunur) —
 * boylece Railway her deploy'da islerin durumunu sifirlamaz.
 */
function sahteIs(name: string) {
  return {
    name, description: `${name} isi`, schedule: '* * * * *', running: false,
    start: vi.fn(), stop: vi.fn(),
  };
}

async function setup() {
  const isler = {
    presenceCron: sahteIs('presence'),
    analyticsAggregateCron: sahteIs('analytics-aggregate'),
    analyticsCleanupCron: sahteIs('analytics-cleanup'),
    notificationEngineCron: sahteIs('notification-engine'),
    campaignDispatchCron: sahteIs('campaign-dispatch'),
    webQuizPurgeCron: sahteIs('web-quiz-purge'),
    seedReplyCron: sahteIs('seed-reply'),
    seedPresenceCron: sahteIs('seed-presence'),
    photoModerationCron: sahteIs('photo-moderation'),
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
  vi.doMock('../../src/cron/seed-presence.cron.js', () => ({ seedPresenceCron: isler.seedPresenceCron }));
  vi.doMock('../../src/cron/photo-moderation.cron.js', () => ({ photoModerationCron: isler.photoModerationCron }));

  const mod = await import('../../src/cron/index.js');
  return { mod, isler };
}

beforeEach(() => vi.resetModules());

describe('initCrons', () => {
  it('kayitli dokuz isin HEPSINI baslatir', async () => {
    const { mod, isler } = await setup();
    mod.initCrons();

    const hepsi = Object.values(isler);
    expect(hepsi).toHaveLength(9);
    for (const is of hepsi) expect(is.start).toHaveBeenCalledTimes(1);
  });

  it('seed-reply listede gorunur ve toggle ile durdurulabilir', async () => {
    const { mod, isler } = await setup();
    mod.initCrons();

    expect(mod.getCronJobs().map((j) => j.name)).toContain('seed-reply');
    expect(mod.toggleCronJob('seed-reply', 'stop')).toBe(true);
    expect(isler.seedReplyCron.stop).toHaveBeenCalledTimes(1);
  });

  it('bilinmeyen is adi icin toggleCronJob false doner', async () => {
    const { mod } = await setup();
    expect(mod.toggleCronJob('olmayan-is', 'start')).toBe(false);
  });
});
