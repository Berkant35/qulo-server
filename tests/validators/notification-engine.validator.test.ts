import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ENGINE_CONFIG,
  engineConfigSchema,
  mergeEngineConfig,
  parseEngineConfigForm,
} from '../../src/validators/notification-engine.validator.js';
import { LIFECYCLE_RULE_KEYS, LIFECYCLE_RULES_BY_KEY } from '../../src/services/notification-engine/rules.js';

describe('notification-engine validator', () => {
  it('varsayilan config semaya uyar ve her kural icin dizi kuraldan gelir', () => {
    expect(engineConfigSchema.safeParse(DEFAULT_ENGINE_CONFIG).success).toBe(true);
    expect(DEFAULT_ENGINE_CONFIG.dry_run).toBe(true);
    for (const key of LIFECYCLE_RULE_KEYS) {
      expect(DEFAULT_ENGINE_CONFIG.rules[key].schedule_days).toEqual(LIFECYCLE_RULES_BY_KEY[key].defaultScheduleDays);
    }
    expect(DEFAULT_ENGINE_CONFIG.rules.lifecycle_profile_incomplete.schedule_days).toEqual([2, 4, 7, 16]);
  });

  it('bos/eksik JSON varsayilanlarla birlesir, bilinmeyen anahtar atilir', () => {
    const { config, valid } = mergeEngineConfig({ send_hour_local: 21, rules: { lifecycle_winback: { enabled: false } }, foo: 1 });
    expect(valid).toBe(true);
    expect(config.send_hour_local).toBe(21);
    expect(config.daily_cap).toBe(DEFAULT_ENGINE_CONFIG.daily_cap);
    expect(config.rules.lifecycle_winback).toEqual({ enabled: false, schedule_days: [30] });
    expect(config.rules.lifecycle_likes_waiting.enabled).toBe(true);
    expect((config as Record<string, unknown>).foo).toBeUndefined();
  });

  it('eski DB kaydindaki cooldown_days yok sayilir, dizi varsayilandan gelir', () => {
    const { config, valid } = mergeEngineConfig({ rules: { lifecycle_winback: { enabled: true, cooldown_days: 14 } } });
    expect(valid).toBe(true);
    expect(config.rules.lifecycle_winback).toEqual({ enabled: true, schedule_days: [30] });
  });

  it('gecersiz deger varsa yarim config yerine TAMAMI varsayilana doner', () => {
    const { config, valid } = mergeEngineConfig({ send_hour_local: 25, daily_cap: 2 });
    expect(valid).toBe(false);
    expect(config).toEqual(DEFAULT_ENGINE_CONFIG);
  });

  it('form: isaretsiz checkbox false, sayilar parse edilir, bos alan mevcut degeri korur', () => {
    const body = {
      enabled: 'on',
      send_hour_local: '20',
      daily_cap: '',
      rule_lifecycle_winback_enabled: 'on',
      rule_lifecycle_winback_schedule: '14, 30',
    };
    const parsed = parseEngineConfigForm(body, DEFAULT_ENGINE_CONFIG);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.enabled).toBe(true);
    expect(parsed.data.dry_run).toBe(false);
    expect(parsed.data.send_hour_local).toBe(20);
    expect(parsed.data.daily_cap).toBe(DEFAULT_ENGINE_CONFIG.daily_cap);
    expect(parsed.data.rules.lifecycle_winback).toEqual({ enabled: true, schedule_days: [14, 30] });
    // alan hic gelmemisse mevcut deger korunur (kismi form); bos string → tek gonderim
    expect(parsed.data.rules.lifecycle_profile_incomplete.schedule_days).toEqual([2, 4, 7, 16]);
    const blank = parseEngineConfigForm({ rule_lifecycle_profile_incomplete_schedule: '' }, DEFAULT_ENGINE_CONFIG);
    expect(blank.success && blank.data.rules.lifecycle_profile_incomplete.schedule_days).toEqual([]);
    expect(parsed.data.rules.lifecycle_likes_waiting.enabled).toBe(false);
  });

  it('form: aralik disi deger reddedilir', () => {
    expect(parseEngineConfigForm({ holdout_pct: '90' }, DEFAULT_ENGINE_CONFIG).success).toBe(false);
    expect(parseEngineConfigForm({ rule_lifecycle_winback_schedule: '0' }, DEFAULT_ENGINE_CONFIG).success).toBe(false);
    expect(parseEngineConfigForm({ rule_lifecycle_winback_schedule: '3, abc' }, DEFAULT_ENGINE_CONFIG).success).toBe(false);
    expect(parseEngineConfigForm({ rule_lifecycle_winback_schedule: '1,1,1,1,1,1,1,1,1,1,1' }, DEFAULT_ENGINE_CONFIG).success).toBe(false);
    expect(parseEngineConfigForm({ rule_lifecycle_winback_schedule: '61' }, DEFAULT_ENGINE_CONFIG).success).toBe(false); // adim > 60: son kayit budanir, dizi bastan baslardi
    expect(parseEngineConfigForm({ send_hour_local: 'abc' }, DEFAULT_ENGINE_CONFIG).success).toBe(false);
  });
});
