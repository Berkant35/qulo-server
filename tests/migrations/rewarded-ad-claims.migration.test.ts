import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIG = join(process.cwd(), 'migrations');
const kod = (t: string) => t.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const sql = kod(readFileSync(join(MIG, '088_rewarded_ad_claims.sql'), 'utf8'));
const rollback = kod(readFileSync(join(MIG, '088_rewarded_ad_claims_rollback.sql'), 'utf8'));

describe('migration 088 rewarded_ad_claims — çift ödülü DB seviyesinde keser', () => {
  it('transaction_id PK + (user_id, day, slot) benzersiz', () => {
    expect(sql).toMatch(/transaction_id\s+text\s+PRIMARY KEY/);
    expect(sql).toMatch(/UNIQUE \(user_id, day, slot\)/);
  });
  it('RLS açık, politika yok, anon/authenticated REVOKE', () => {
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).toMatch(/REVOKE ALL ON public\.rewarded_ad_claims FROM anon, authenticated/);
  });
  it('rollback yalnız bu tabloyu düşürür', () => {
    expect(rollback).toMatch(/DROP TABLE IF EXISTS public\.rewarded_ad_claims/);
    expect(rollback).not.toMatch(/diamond_transactions|users/);
  });
});
