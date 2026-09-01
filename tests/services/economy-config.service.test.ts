import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';
import { activeConfigRow, economyConfigFixture } from '../helpers/economy-config.fixture.js';
import type { EconomyConfigVersion } from '../../src/types/economy-config.schema.js';

/**
 * Ekonominin tek fiyat kaynağı. Buradaki bir hata tüm harcama/ödül akışlarına yayılır,
 * o yüzden schema doğrulaması ve cache davranışı ayrı ayrı sabitleniyor.
 */
async function setup(seed: Tables = {}, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase({ economy_config_versions: [activeConfigRow()], ...seed }, options);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { economyConfigService } = await import('../../src/services/economy-config.service.js');
  return { fake, economyConfigService };
}

const NOW = new Date('2026-09-01T12:00:00Z');

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getActiveConfig', () => {
  it('aktif config\'i versiyonuyla döner', async () => {
    const { economyConfigService } = await setup();
    const { version, config } = await economyConfigService.getActiveConfig();

    expect(version).toBe(1);
    expect(config.core.greenToPurpleRatio).toBe(3);
  });

  it('pasif versiyonu seçmez', async () => {
    const { economyConfigService } = await setup({
      economy_config_versions: [
        { ...activeConfigRow(), id: 'old', version: 1, is_active: false },
        {
          ...activeConfigRow({ core: { ...economyConfigFixture.core, greenToPurpleRatio: 7 } }),
          id: 'new', version: 2, is_active: true,
        },
      ],
    });

    const { version, config } = await economyConfigService.getActiveConfig();
    expect(version).toBe(2);
    expect(config.core.greenToPurpleRatio).toBe(7);
  });

  it('aktif config yoksa hata atar', async () => {
    const { economyConfigService } = await setup({ economy_config_versions: [] });
    await expect(economyConfigService.getActiveConfig()).rejects.toThrow('No active economy config found');
  });

  /** Bozuk config sessizce geçerse yanlış fiyatlarla çalışırız — patlaması doğru davranış. */
  it('schema\'ya uymayan config parse hatası verir', async () => {
    const { economyConfigService } = await setup({
      economy_config_versions: [{
        ...activeConfigRow(),
        config: { ...economyConfigFixture, core: { ...economyConfigFixture.core, greenToPurpleRatio: 999 } },
      }],
    });

    await expect(economyConfigService.getActiveConfig()).rejects.toThrow();
  });

  it('eksik alanlı config parse hatası verir', async () => {
    const { core, ...withoutCore } = economyConfigFixture;
    const { economyConfigService } = await setup({
      economy_config_versions: [{ ...activeConfigRow(), config: withoutCore }],
    });

    await expect(economyConfigService.getActiveConfig()).rejects.toThrow();
  });

  it('retention alanı yoksa varsayılana düşer (eski versiyonlarla geriye uyum)', async () => {
    const { retention, ...withoutRetention } = economyConfigFixture;
    const { economyConfigService } = await setup({
      economy_config_versions: [{ ...activeConfigRow(), config: withoutRetention }],
    });

    const { config } = await economyConfigService.getActiveConfig();
    expect(config.retention).toEqual({ deletionDiamondAmount: 15, minAccountAgeDays: 7 });
  });
});

describe('cache', () => {
  it('ikinci çağrı DB\'ye gitmez', async () => {
    const { fake, economyConfigService } = await setup();

    await economyConfigService.getActiveConfig();
    // Tabloyu boşalt: cache çalışmıyorsa ikinci çağrı hata atardı.
    fake.table('economy_config_versions').length = 0;

    await expect(economyConfigService.getActiveConfig()).resolves.toMatchObject({ version: 1 });
  });

  it('TTL dolunca yeniden okur', async () => {
    const { fake, economyConfigService } = await setup();
    await economyConfigService.getActiveConfig();

    fake.table('economy_config_versions')[0].config = {
      ...economyConfigFixture,
      core: { ...economyConfigFixture.core, greenToPurpleRatio: 5 },
    };
    vi.setSystemTime(new Date(NOW.getTime() + 6 * 60 * 1000)); // 5 dk TTL + 1

    const { config } = await economyConfigService.getActiveConfig();
    expect(config.core.greenToPurpleRatio).toBe(5);
  });

  /** DB kısa süre erişilemezse ekonomi durmasın — eski değerle devam. */
  it('DB hatası olsa bile eski cache dönülür', async () => {
    const { fake, economyConfigService } = await setup();
    await economyConfigService.getActiveConfig();

    fake.table('economy_config_versions').length = 0;
    vi.setSystemTime(new Date(NOW.getTime() + 6 * 60 * 1000));

    await expect(economyConfigService.getActiveConfig()).resolves.toMatchObject({ version: 1 });
  });

  it('invalidateCache sonrası yeniden okur', async () => {
    const { fake, economyConfigService } = await setup();
    await economyConfigService.getActiveConfig();

    fake.table('economy_config_versions')[0].config = {
      ...economyConfigFixture,
      core: { ...economyConfigFixture.core, greenToPurpleRatio: 9 },
    };
    economyConfigService.invalidateCache();

    const { config } = await economyConfigService.getActiveConfig();
    expect(config.core.greenToPurpleRatio).toBe(9);
  });

  it('getConfig sadece config gövdesini döner', async () => {
    const { economyConfigService } = await setup();
    await expect(economyConfigService.getConfig()).resolves.toMatchObject({
      core: expect.objectContaining({ greenToPurpleRatio: 3 }),
    });
  });
});

describe('createVersion', () => {
  const nextConfig = {
    ...economyConfigFixture,
    core: { ...economyConfigFixture.core, greenToPurpleRatio: 4 },
  };

  it('RPC başarılıysa onun sonucunu döner ve cache\'i temizler', async () => {
    const created = { id: 'v2', version: 2, config: nextConfig, is_active: true };
    const { fake, economyConfigService } = await setup({}, {
      rpc: { create_economy_config_version: { data: created } },
    });

    await economyConfigService.getActiveConfig(); // cache doldur
    const result = await economyConfigService.createVersion(nextConfig, 'admin', 'zam');

    expect(result).toMatchObject({ version: 2 });
    expect(fake.rpcCalls[0]).toMatchObject({
      name: 'create_economy_config_version',
      args: expect.objectContaining({ p_version: 2, p_changed_by: 'admin', p_change_reason: 'zam' }),
    });
  });

  it('versiyon numarası en yüksekten bir fazla', async () => {
    const { fake, economyConfigService } = await setup({
      economy_config_versions: [
        { ...activeConfigRow(), id: 'a', version: 7, is_active: true },
      ],
    }, { rpc: { create_economy_config_version: { data: { id: 'x', version: 8 } } } });

    await economyConfigService.createVersion(nextConfig, 'admin', 'test');
    expect((fake.rpcCalls[0].args as Record<string, unknown>).p_version).toBe(8);
  });

  it('hiç versiyon yoksa 1\'den başlar', async () => {
    const { fake, economyConfigService } = await setup({ economy_config_versions: [] }, {
      rpc: { create_economy_config_version: { data: { id: 'x', version: 1 } } },
    });

    await economyConfigService.createVersion(nextConfig, 'admin', 'ilk');
    expect((fake.rpcCalls[0].args as Record<string, unknown>).p_version).toBe(1);
  });

  it('RPC patlarsa iki sorgulu yedek yola düşer: eskiyi pasifler, yeniyi ekler', async () => {
    const { fake, economyConfigService } = await setup({}, {
      rpc: { create_economy_config_version: { error: { message: 'rpc yok' } } },
    });

    const result = await economyConfigService.createVersion(nextConfig, 'admin', 'zam');

    const rows = fake.table('economy_config_versions');
    expect(rows.find((r) => r.version === 1)!.is_active).toBe(false);
    expect(result).toMatchObject({ version: 2, is_active: true, change_reason: 'zam' });
  });

  /** Sınır dışı değer DB'ye hiç ulaşmamalı. */
  it('sınır dışı değeri reddeder ve DB\'ye yazmaz', async () => {
    const { fake, economyConfigService } = await setup();
    const invalid = {
      ...economyConfigFixture,
      core: { ...economyConfigFixture.core, greenToPurpleRatio: 20 }, // max 10
    };

    await expect(economyConfigService.createVersion(invalid, 'admin', 'hatali')).rejects.toThrow();
    expect(fake.table('economy_config_versions')).toHaveLength(1);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it('güç maliyeti sınırını aşan config reddedilir', async () => {
    const { economyConfigService } = await setup();
    const invalid = {
      ...economyConfigFixture,
      powerCosts: {
        ...economyConfigFixture.powerCosts,
        ORACLE: { greenCost: 9999, purpleCost: 15 }, // max 500
      },
    };

    await expect(economyConfigService.createVersion(invalid, 'admin', 'hatali')).rejects.toThrow();
  });

  it('yeni versiyon sonrası cache tazelenir', async () => {
    const { economyConfigService } = await setup({}, {
      rpc: { create_economy_config_version: { error: { message: 'rpc yok' } } },
    });

    await economyConfigService.getActiveConfig();
    await economyConfigService.createVersion(nextConfig, 'admin', 'zam');

    const { config } = await economyConfigService.getActiveConfig();
    expect(config.core.greenToPurpleRatio).toBe(4);
  });
});

describe('getHistory / getVersion', () => {
  const versions = [1, 2, 3].map((v) => ({
    ...activeConfigRow(), id: `v${v}`, version: v, is_active: v === 3,
  }));

  it('geçmişi en yeniden eskiye sıralar', async () => {
    const { economyConfigService } = await setup({ economy_config_versions: versions });
    const history = await economyConfigService.getHistory();
    expect(history.map((h) => h.version)).toEqual([3, 2, 1]);
  });

  it('limit uygulanır', async () => {
    const { economyConfigService } = await setup({ economy_config_versions: versions });
    await expect(economyConfigService.getHistory(2)).resolves.toHaveLength(2);
  });

  it('belirli versiyonu getirir', async () => {
    const { economyConfigService } = await setup({ economy_config_versions: versions });
    await expect(economyConfigService.getVersion(2)).resolves.toMatchObject({ version: 2 });
  });

  it('olmayan versiyon için null döner (hata atmaz)', async () => {
    const { economyConfigService } = await setup({ economy_config_versions: versions });
    await expect(economyConfigService.getVersion(99)).resolves.toBeNull();
  });
});

describe('compareVersions', () => {
  const version = (v: number, config: unknown) =>
    ({ id: `v${v}`, version: v, config, is_active: false, changed_by: null, change_reason: '', created_at: '' }) as EconomyConfigVersion;

  it('değişen alanı yolu ve eski/yeni değeriyle listeler', async () => {
    const { economyConfigService } = await setup();
    const v1 = version(1, economyConfigFixture);
    const v2 = version(2, {
      ...economyConfigFixture,
      core: { ...economyConfigFixture.core, greenToPurpleRatio: 5 },
    });

    const diff = economyConfigService.compareVersions(v1, v2);

    expect(diff).toMatchObject({ v1: 1, v2: 2 });
    expect(diff.changes).toEqual([
      { path: 'config.core.greenToPurpleRatio', oldValue: 3, newValue: 5 },
    ]);
  });

  it('aynı config için değişiklik listelemez', async () => {
    const { economyConfigService } = await setup();
    const diff = economyConfigService.compareVersions(
      version(1, economyConfigFixture),
      version(2, economyConfigFixture),
    );
    expect(diff.changes).toEqual([]);
  });

  it('iç içe alanlardaki birden çok değişikliği bulur', async () => {
    const { economyConfigService } = await setup();
    const v2 = version(2, {
      ...economyConfigFixture,
      powerCosts: {
        ...economyConfigFixture.powerCosts,
        ORACLE: { greenCost: 99, purpleCost: 33 },
      },
    });

    const diff = economyConfigService.compareVersions(version(1, economyConfigFixture), v2);
    const paths = diff.changes.map((c) => c.path).sort();

    expect(paths).toEqual([
      'config.powerCosts.ORACLE.greenCost',
      'config.powerCosts.ORACLE.purpleCost',
    ]);
  });
});
