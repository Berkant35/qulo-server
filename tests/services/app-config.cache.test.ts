import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type FailureSpec, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';

/**
 * app_config satiri her resume'da (/app/config) ve seed cron'unun her tikinde okunuyordu; artik
 * 60 sn surec ici onbellek. Admin guncellemesi temizler; suren okuma eski satiri geri yazamaz.
 */
function satir(ek: Record<string, unknown> = {}) {
  return {
    id: 'cfg', min_version_ios: '2.0.0', min_version_android: '2.0.0',
    latest_version_ios: '2.0.14', latest_version_android: '2.0.14',
    store_url_ios: 'ios', store_url_android: 'android', is_maintenance: false,
    maintenance_message_tr: null, maintenance_message_en: null, is_force_update_enabled: false,
    seed_reply_enabled: true, seed_reply_fast_mode: false, photo_moderation_enabled: true,
    updated_at: '2026-09-28T00:00:00Z', ...ek,
  };
}

async function setup(
  opts: { failOn?: FailureSpec[]; holdRead?: FakeSupabaseOptions['holdRead']; satirEk?: Record<string, unknown> } = {},
) {
  const { satirEk, ...fakeOpts } = opts;
  const fake = createFakeSupabase({ app_config: [satir(satirEk)] }, fakeOpts);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { appConfigService } = await import('../../src/services/app-config.service.js');
  const okumalar = () => fake.queries.filter((q) => q.table === 'app_config' && q.op === 'select').length;
  return { fake, appConfigService, okumalar };
}

beforeEach(() => vi.resetModules());

describe('appConfigService.getRow onbellegi', () => {
  it('getConfig ve getRow ayni onbellegi paylasir: ardisik cagrilar tek okuma', async () => {
    const { appConfigService, okumalar } = await setup();
    expect((await appConfigService.getConfig('ios', 'tr')).latestVersion).toBe('2.0.14');
    expect((await appConfigService.getRow())?.seed_reply_enabled).toBe(true);
    expect(okumalar()).toBe(1);
  });

  it('okuma hatasi null doner (getConfig varsayilanlari) ve onbellege YAZILMAZ', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { appConfigService, okumalar } = await setup({ failOn: [{ table: 'app_config', op: 'select' }] });
    expect(await appConfigService.getRow()).toBeNull();
    expect((await appConfigService.getConfig('android', 'en')).minVersion).toBe('0.0.0');
    expect(okumalar()).toBe(2);
    expect(log).toHaveBeenCalledWith('[app-config] okunamadi:', expect.any(String));
    log.mockRestore();
  });

  it('admin guncellemesi sirasinda suren okuma eski satiri onbellege GERI YAZAMAZ (yaris)', async () => {
    // Review 2026-09-28'de yeniden uretildi: panelden seed kill-switch kapatilirken suren bir
    // /app/config okumasi eski "acik" satiri 60 sn geri yaziyordu; sonraki tik botu calistiriyordu.
    let ac: () => void = () => undefined;
    const kapi = new Promise<void>((r) => { ac = r; });
    const { appConfigService } = await setup({ holdRead: { table: 'app_config', until: kapi } });

    const surenOkuma = appConfigService.getRow();
    await appConfigService.updateConfig({ seed_reply_enabled: false });
    ac();
    expect((await surenOkuma)?.seed_reply_enabled).toBe(true);   // o okuma eskiyi gorur

    expect((await appConfigService.getRow())?.seed_reply_enabled).toBe(false);
  });
});

describe('appConfigService.getDiscoverDormantDays (migration 074)', () => {
  it('kolondaki degeri doner ve onbellekler: ardisik cagrilar tek okuma', async () => {
    const { appConfigService, okumalar } = await setup({ satirEk: { discover_dormant_days: 21 } });
    expect(await appConfigService.getDiscoverDormantDays()).toBe(21);
    expect(await appConfigService.getDiscoverDormantDays()).toBe(21);
    expect(okumalar()).toBe(1);
  });

  it('0 (kapali) gecerli bir degerdir, varsayilana dusmez', async () => {
    const { appConfigService } = await setup({ satirEk: { discover_dormant_days: 0 } });
    expect(await appConfigService.getDiscoverDormantDays()).toBe(0);
  });

  it('kolon yoksa (074 uygulanmadan deploy) varsayilan 14 doner; varsayilan da onbelleklenir, uyari bir kez', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { appConfigService, okumalar } = await setup();   // satirda kolon yok
    const { DEFAULT_DISCOVER_DORMANT_DAYS } = await import('../../src/services/app-config.service.js');
    expect(await appConfigService.getDiscoverDormantDays()).toBe(DEFAULT_DISCOVER_DORMANT_DAYS);
    expect(await appConfigService.getDiscoverDormantDays()).toBe(14);
    expect(okumalar()).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('kolon yok hatasi (42703) varsayilani onbellekler', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { appConfigService, okumalar } = await setup({
      failOn: [{ table: 'app_config', op: 'select', error: { message: 'column does not exist', code: '42703' } }],
    });
    expect(await appConfigService.getDiscoverDormantDays()).toBe(14);
    expect(await appConfigService.getDiscoverDormantDays()).toBe(14);
    expect(okumalar()).toBe(1);
    warn.mockRestore();
  });

  it('gecici okuma hatasi: o cagri varsayilani kullanir (discover patlamaz) ama ONBELLEKLENMEZ — admin 0 degeri geri gelir', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { appConfigService, okumalar } = await setup({
      satirEk: { discover_dormant_days: 0 },
      failOn: [{ table: 'app_config', op: 'select', error: { message: 'timeout', code: '57014' }, times: 1 }],
    });
    expect(await appConfigService.getDiscoverDormantDays()).toBe(14);
    expect(await appConfigService.getDiscoverDormantDays()).toBe(0);
    expect(okumalar()).toBe(2);
    err.mockRestore();
  });

  it('admin guncellemesi esik onbellegini de temizler', async () => {
    const { appConfigService } = await setup({ satirEk: { discover_dormant_days: 14 } });
    expect(await appConfigService.getDiscoverDormantDays()).toBe(14);
    await appConfigService.updateConfig({ discover_dormant_days: 30 });
    expect(await appConfigService.getDiscoverDormantDays()).toBe(30);
  });
});
