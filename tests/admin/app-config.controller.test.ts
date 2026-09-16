import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Version regex'inden gecen zorunlu alanlar — testin konusu bunlar degil. */
const GECERLI = {
  min_version_ios: '1.0.0', min_version_android: '1.0.0',
  latest_version_ios: '1.2.0', latest_version_android: '1.2.0',
  store_url_ios: 'https://apps.apple.com/x', store_url_android: 'https://play.google.com/x',
};

function fakeRes() {
  const res: any = {
    redirectedTo: null as string | null,
    redirect(url: string) { res.redirectedTo = url; return res; },
  };
  return res;
}

async function setup(body: Record<string, unknown>) {
  const updateConfig = vi.fn(async (_updates: Record<string, unknown>) => ({}));
  vi.doMock('../../src/services/app-config.service.js', () => ({ appConfigService: { updateConfig } }));

  const { adminController } = await import('../../src/admin/admin.controller.js');
  const res = fakeRes();
  await adminController.updateAppConfig({ body: { ...GECERLI, ...body }, session: {} } as any, res);
  return { updateConfig, res, patch: () => updateConfig.mock.calls[0]![0] };
}

beforeEach(() => vi.resetModules());

describe('updateAppConfig — seed AI kill-switch alanlari', () => {
  it('seed_reply_enabled="on" ise true yazar', async () => {
    const { patch } = await setup({ seed_reply_enabled: 'on' });
    expect(patch()).toMatchObject({ seed_reply_enabled: true });
  });

  it('seed_reply_fast_mode="on" ise true yazar', async () => {
    const { patch } = await setup({ seed_reply_fast_mode: 'on' });
    expect(patch()).toMatchObject({ seed_reply_fast_mode: true });
  });

  it('alan gonderilmis ama isaretsizse false yazar', async () => {
    const { patch } = await setup({ seed_reply_enabled: '', seed_reply_fast_mode: '' });
    expect(patch()).toMatchObject({ seed_reply_enabled: false, seed_reply_fast_mode: false });
  });

  it('checkbox isaretsizken (alan gelmez) false yazar — panelden KAPATILABILIR', async () => {
    // app-config.ejs iki checkbox'i da render eder; isaretsiz checkbox govdeye hic
    // girmez. Bu durumda "dokunma" davranisi paneli tek yonlu yapardi: acilir, kapanmaz.
    const { patch } = await setup({});
    expect(patch()).toMatchObject({ seed_reply_enabled: false, seed_reply_fast_mode: false });
  });
});
