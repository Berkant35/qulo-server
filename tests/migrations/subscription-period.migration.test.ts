import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIG = join(process.cwd(), 'migrations');
const kod = (t: string) => t.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const sql = kod(readFileSync(join(MIG, '089_subscription_period.sql'), 'utf8'));
const rollback = kod(readFileSync(join(MIG, '089_subscription_period_rollback.sql'), 'utf8'));

describe('migration 089 subscription_period', () => {
  it('nullable kolon + yalnız weekly/monthly kısıtı; mevcut satırlara dokunmaz', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS subscription_period text;/);
    expect(sql).toMatch(/subscription_period IS NULL OR subscription_period IN \('weekly', 'monthly'\)/);
    expect(sql).not.toMatch(/\bUPDATE\b|\bDELETE\b|NOT NULL/);
  });
  it('rollback yalnız bu kolonu ve kısıtını düşürür', () => {
    expect(rollback).toMatch(/DROP COLUMN IF EXISTS subscription_period/);
    expect(rollback).not.toMatch(/DROP TABLE|TRUNCATE/);
  });
});
