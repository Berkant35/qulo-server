import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIG = join(process.cwd(), 'migrations');
const sql = readFileSync(join(MIG, '086_whats_new.sql'), 'utf8');
const rollback = readFileSync(join(MIG, '086_whats_new_rollback.sql'), 'utf8');
/** Yorum satırları atılır: "politika EKLEME" gibi açıklamalar yanlış alarm vermesin. */
const kod = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('migration 086 whats_new — güvenlik biçimi (yalnız service_role)', () => {
  it('RLS açık', () => {
    expect(kod).toMatch(/ALTER TABLE public\.whats_new ENABLE ROW LEVEL SECURITY/);
  });

  it('hiç politika yok', () => {
    expect(kod).not.toMatch(/CREATE POLICY/i);
  });

  it('anon ve authenticated yetkileri geri alınır, geri verilmez', () => {
    expect(kod).toMatch(/REVOKE ALL ON public\.whats_new FROM anon, authenticated/);
    expect(kod).not.toMatch(/GRANT /i);
  });

  it('aktif kayıtta (app_version, platform) benzersiz; platform ve https denetimi var', () => {
    expect(kod).toMatch(/UNIQUE INDEX[\s\S]*\(app_version, platform\)[\s\S]*WHERE is_active/);
    expect(kod).toMatch(/platform IN \('all', 'ios', 'android'\)/);
    expect(kod).toMatch(/\^https:\/\//);
    expect(kod).toMatch(/content \? 'en'/);
  });

  it('is_active varsayılanı false', () => {
    expect(kod).toMatch(/is_active\s+boolean\s+NOT NULL DEFAULT false/);
  });

  it('rollback tabloyu düşürür', () => {
    expect(rollback).toMatch(/DROP TABLE IF EXISTS public\.whats_new/);
  });
});
