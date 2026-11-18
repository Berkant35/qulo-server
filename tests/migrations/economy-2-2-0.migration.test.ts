import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { economyConfigSchema, DEFAULT_PROFILE_MILESTONES, DEFAULT_BADGE_REWARDS, ECONOMY_BOUNDARIES } from '../../src/types/economy-config.schema.js';

const MIG = join(process.cwd(), 'migrations');
const sql = readFileSync(join(MIG, '087_economy_2_2_0.sql'), 'utf8');
const rollback = readFileSync(join(MIG, '087_economy_2_2_0_rollback.sql'), 'utf8');
const kod = (t: string) => t.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('migration 087 economy_2_2_0 — sürümlü config, ezme/silme yok', () => {
  it('yeni sürüm RPC ile eklenir (eskisi is_active=false olur), mevcut satırlar UPDATE/DELETE edilmez', () => {
    const k = kod(sql);
    expect(k).toMatch(/create_economy_config_version\(/);
    expect(k).not.toMatch(/DELETE\s+FROM/i);
    expect(k).not.toMatch(/UPDATE\s+(public\.)?economy_config_versions/i);
    expect(k).not.toMatch(/DROP |TRUNCATE/i);
  });

  it('yeni değerleri yazar: free 25, milestones 2/3/5/10, rozet 1/3', () => {
    const k = kod(sql);
    expect(k).toMatch(/\{subscriptionLimits,free,dailyDiscovers\}[\s\S]*'25'/);
    expect(k).toMatch(/"25": ?2, ?"50": ?3, ?"75": ?5, ?"100": ?10/);
    expect(k).toMatch(/"SILVER": ?1, ?"GOLD": ?3/);
  });

  it('başlangıç (starterPurple/starterPowers) ve referans dokunulmaz', () => {
    const k = kod(sql);
    expect(k).not.toMatch(/starterPurple|starterPowers|referralPurple/);
  });

  it('yeniden çalıştırmaya dayanıklı (zaten yeni değerdeyse sürüm eklemez) ve aktif config yoksa hata verir', () => {
    const k = kod(sql);
    expect(k).toMatch(/IF .*= 25/s);
    expect(k).toMatch(/RAISE EXCEPTION/);
  });

  it('rollback önceki sürümü aktif eder, 087 satırını silmez; 087 aktif değilse durur', () => {
    const k = kod(rollback);
    expect(k).toMatch(/is_active\s*=\s*true/);
    expect(k).toMatch(/RAISE EXCEPTION/);
    expect(k).not.toMatch(/DELETE\s+FROM/i);
  });
});

describe('kod yedek değerleri şemadan geçer ve sınırlar içinde', () => {
  it('2/3/5/10 ve 1/3 sabitleri; toplam 20', () => {
    expect(DEFAULT_PROFILE_MILESTONES).toEqual({ '25': 2, '50': 3, '75': 5, '100': 10 });
    expect(Object.values(DEFAULT_PROFILE_MILESTONES).reduce((a, b) => a + b, 0)).toBe(20);
    expect(DEFAULT_BADGE_REWARDS).toEqual({ SILVER: 1, GOLD: 3 });
  });

  it('rewards.badges alanı olmayan eski config satırı parse edilir ve yedek rozet değerlerini alır', async () => {
    const { economyConfigFixture } = await import('../helpers/economy-config.fixture.js');
    const { badges: _drop, ...rewardsWithoutBadges } = economyConfigFixture.rewards;
    const parsed = economyConfigSchema.parse({ ...economyConfigFixture, rewards: rewardsWithoutBadges });
    expect(parsed.rewards.badges).toEqual({ SILVER: 1, GOLD: 3 });
  });

  it('free dailyDiscovers 25 watchdog sınırı (10–200) içinde', () => {
    expect(25).toBeGreaterThanOrEqual(ECONOMY_BOUNDARIES.free.dailyDiscovers.min);
    expect(25).toBeLessThanOrEqual(ECONOMY_BOUNDARIES.free.dailyDiscovers.max);
  });
});
