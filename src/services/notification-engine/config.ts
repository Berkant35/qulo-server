import { supabase } from '../../config/supabase.js';
import { DEFAULT_ENGINE_CONFIG, mergeEngineConfig } from '../../validators/notification-engine.validator.js';
import type { EngineConfig } from '../../validators/notification-engine.validator.js';

export interface LoadedEngineConfig {
  config: EngineConfig;
  /** Migration 045 uygulanmamis: tablo yok. Motor kapali sayilir, backoffice uyari gosterir. */
  tableMissing: boolean;
  /** Okuma hatasi mesaji (tablo yok dahil); basarida null. */
  loadError: string | null;
  /** DB'deki JSON gecersizdi, varsayilan kullanildi. */
  usedDefaults: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

const CONFIG_ROW_ID = 1;

export async function loadEngineConfig(): Promise<LoadedEngineConfig> {
  const { data, error } = await supabase
    .from('notification_engine_config')
    .select('config, updated_at, updated_by')
    .eq('id', CONFIG_ROW_ID)
    .maybeSingle();

  if (error) {
    // 42P01 = undefined_table (migration 045 uygulanmamis). Diger hatalar gecici sayilir; ikisinde de motor kapali.
    const tableMissing = error.code === '42P01' || /does not exist/i.test(error.message ?? '');
    console.warn(`[NotificationEngine] config okunamadi${tableMissing ? ' (migration 045 uygulanmamis)' : ''}:`, error.message);
    return {
      config: { ...DEFAULT_ENGINE_CONFIG, enabled: false },
      tableMissing,
      loadError: error.message,
      usedDefaults: true,
      updatedAt: null,
      updatedBy: null,
    };
  }

  const { config, valid } = mergeEngineConfig(data?.config);
  return {
    config,
    tableMissing: false,
    loadError: null,
    usedDefaults: !valid,
    updatedAt: (data?.updated_at as string | null) ?? null,
    updatedBy: (data?.updated_by as string | null) ?? null,
  };
}

export async function saveEngineConfig(config: EngineConfig, updatedBy: string): Promise<void> {
  const { error } = await supabase
    .from('notification_engine_config')
    .upsert(
      { id: CONFIG_ROW_ID, config, updated_at: new Date().toISOString(), updated_by: updatedBy },
      { onConflict: 'id' },
    );
  if (error) throw error;
}
