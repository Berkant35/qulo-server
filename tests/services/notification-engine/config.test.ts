import { describe, it, expect, vi } from 'vitest';
import { createFakeSupabase } from '../../helpers/fake-supabase.js';
import type { FailureSpec, Tables } from '../../helpers/fake-supabase.js';

async function boot(tables: Tables, failOn?: FailureSpec[]) {
  vi.resetModules();
  const fake = createFakeSupabase(tables, { failOn });
  vi.doMock('../../../src/config/supabase.js', () => ({ supabase: fake.client, ensureStorageBuckets: async () => {} }));
  const mod = await import('../../../src/services/notification-engine/config.js');
  return { fake, ...mod };
}

describe('notification-engine/config', () => {
  it('bos satir ({}) → varsayilanlar, tablo var, hata yok', async () => {
    const { loadEngineConfig } = await boot({ notification_engine_config: [{ id: 1, config: {} }] });
    const loaded = await loadEngineConfig();
    expect(loaded).toMatchObject({ tableMissing: false, loadError: null, usedDefaults: false });
    expect(loaded.config).toMatchObject({ enabled: true, dry_run: true, send_hour_local: 19 });
  });

  it('tablo yok (42P01) → tableMissing, motor kapali', async () => {
    const { loadEngineConfig } = await boot({}, [{ table: 'notification_engine_config', op: 'select', error: { message: 'relation "notification_engine_config" does not exist', code: '42P01' } }]);
    const loaded = await loadEngineConfig();
    expect(loaded.tableMissing).toBe(true);
    expect(loaded.config.enabled).toBe(false);
  });

  it('gecici DB hatasi → tableMissing DEGIL ama loadError dolu, motor yine kapali', async () => {
    const { loadEngineConfig } = await boot({}, [{ table: 'notification_engine_config', op: 'select', error: { message: 'connection reset', code: '08006' } }]);
    const loaded = await loadEngineConfig();
    expect(loaded.tableMissing).toBe(false);
    expect(loaded.loadError).toBe('connection reset');
    expect(loaded.config.enabled).toBe(false);
  });

  it('gecersiz JSON → usedDefaults, varsayilan config', async () => {
    const { loadEngineConfig } = await boot({ notification_engine_config: [{ id: 1, config: { send_hour_local: 99 } }] });
    const loaded = await loadEngineConfig();
    expect(loaded.usedDefaults).toBe(true);
    expect(loaded.config.send_hour_local).toBe(19);
  });

  it('saveEngineConfig id=1 satirini upsert eder (updated_by ile)', async () => {
    const { fake, loadEngineConfig, saveEngineConfig } = await boot({ notification_engine_config: [{ id: 1, config: {} }] });
    const { config } = await loadEngineConfig();
    await saveEngineConfig({ ...config, enabled: false, send_hour_local: 21 }, 'admin@qulo.test');
    const rows = fake.table('notification_engine_config');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, updated_by: 'admin@qulo.test' });
    expect(rows[0]!.config).toMatchObject({ enabled: false, send_hour_local: 21 });
    expect((await loadEngineConfig()).config.send_hour_local).toBe(21);
  });
});
