import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * initCrons() uretimde KAYITLI HER isi baslatir. Seed AI cevaplarinin kapisi surec ici
 * start/stop degil, app_config.seed_reply_enabled bayragidir (her tikta okunur) —
 * boylece Railway her deploy'da islerin durumunu sifirlamaz.
 *
 * Uretim disinda HICBIR is baslamaz: yerel `npm run dev` ayni prod Supabase'ine bagli
 * (ayri test DB'si yok). 2026-09-27'de bir gelistirici makinesi ikinci cron calistiricisi
 * olarak 24 saatteki 678 bin API isteginin yarisini uretiyordu.
 */
function sahteIs(name: string) {
  return {
    name, description: `${name} isi`, schedule: '* * * * *', running: false,
    start: vi.fn(), stop: vi.fn(),
  };
}

/**
 * `env` verilirse `config/env` mock'lanir: arguman'siz `initCrons()` sureci env'ini okur ve
 * gelistiricinin `.env`'indeki `CRON_ENABLED` (dotenv yukler) testi makineye bagimli yapardi.
 */
async function setup(env?: { NODE_ENV: string; CRON_ENABLED?: string }) {
  if (env) vi.doMock('../../src/config/env.js', () => ({ env }));
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

const URETIM = { NODE_ENV: 'production' } as const;

describe('initCrons', () => {
  it('uretimde kayitli dokuz isin HEPSINI baslatir', async () => {
    const { mod, isler } = await setup();
    mod.initCrons(URETIM);

    const hepsi = Object.values(isler);
    expect(hepsi).toHaveLength(9);
    for (const is of hepsi) expect(is.start).toHaveBeenCalledTimes(1);
  });

  it('development ortaminda HICBIR is baslamaz (yerel sunucu prod DB\'ye bagli)', async () => {
    const { mod, isler } = await setup();
    mod.initCrons({ NODE_ENV: 'development' });
    for (const is of Object.values(isler)) expect(is.start).not.toHaveBeenCalled();
  });

  // src/index.ts initCrons()'u argumansiz cagirir — kapi bu varsayilan yoldan gecmeli.
  it('argumansiz cagri surecin env\'ini okur: test ortaminda is baslamaz', async () => {
    const { mod, isler } = await setup({ NODE_ENV: 'test' });
    mod.initCrons();
    for (const is of Object.values(isler)) expect(is.start).not.toHaveBeenCalled();
  });

  it('argumansiz cagri surecin env\'ini okur: uretimde hepsi baslar', async () => {
    const { mod, isler } = await setup({ NODE_ENV: 'production' });
    mod.initCrons();
    for (const is of Object.values(isler)) expect(is.start).toHaveBeenCalledTimes(1);
  });

  it('CRON_ENABLED=true development ortaminda da baslatir (bilincli yerel deneme)', async () => {
    const { mod, isler } = await setup();
    mod.initCrons({ NODE_ENV: 'development', CRON_ENABLED: 'true' });
    for (const is of Object.values(isler)) expect(is.start).toHaveBeenCalledTimes(1);
  });

  it('CRON_ENABLED=false uretimde de durdurur (ornegin ikinci bir servis/replika)', async () => {
    const { mod, isler } = await setup();
    mod.initCrons({ NODE_ENV: 'production', CRON_ENABLED: 'false' });
    for (const is of Object.values(isler)) expect(is.start).not.toHaveBeenCalled();
  });

  it('seed-reply listede gorunur ve toggle ile durdurulabilir', async () => {
    const { mod, isler } = await setup();
    mod.initCrons(URETIM);

    expect(mod.getCronJobs().map((j) => j.name)).toContain('seed-reply');
    expect(mod.toggleCronJob('seed-reply', 'stop')).toBe(true);
    expect(isler.seedReplyCron.stop).toHaveBeenCalledTimes(1);
  });

  it('bilinmeyen is adi icin toggleCronJob false doner', async () => {
    const { mod } = await setup();
    expect(mod.toggleCronJob('olmayan-is', 'start')).toBe(false);
  });
});
