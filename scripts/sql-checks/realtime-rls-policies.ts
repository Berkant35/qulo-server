/**
 * 082/083 (matches/messages RLS) sınaması, prod tablolarına DOKUNMADAN.
 *
 * Migration gövdeleri (BEGIN..COMMIT arası, elle kopya YOK) geçici şemadaki `LIKE public.<tablo>`
 * kopyalarına uygulanır. Bugünkü yetki hali (anon + authenticated SELECT) önce kurulur, sonra migration
 * çalışır. Sentetik satırlarla Realtime'ın yaptığı gibi `role` + `request.jwt.claims` ayarlanır:
 * katılımcı / yabancı / pasif eşleşme / silinmiş mesaj / sub'sız authenticated / anon görünürlüğü sayılır. Sonda RAISE EXCEPTION
 * her şeyi geri alır (desen: seed-reply-candidates.ts).
 *
 * Kullanım: npx tsx scripts/sql-checks/realtime-rls-policies.ts > /tmp/x.sql
 *           → Supabase SQL editor / MCP execute_sql. Beklenen: hata mesajında "SONUC ... HEPSI_GECTI".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KOK } from './ortak.js';

const S = 'rls_sinama_082_083';
const MIGRATIONS = ['082_matches_rls_katilimci.sql', '083_messages_rls_katilimci.sql'];

function govde(dosya: string): string {
  const src = readFileSync(join(KOK, 'migrations', dosya), 'utf8');
  const bas = src.indexOf('BEGIN;');
  const son = src.indexOf('COMMIT;');
  if (bas < 0 || son < bas) throw new Error(`BEGIN/COMMIT bulunamadi: ${dosya}`);
  const sql = src.slice(bas + 'BEGIN;'.length, son)
    .replace(/^\s*--.*$/gm, '')
    .replaceAll('public.matches', `${S}.matches`)
    .replaceAll('public.messages', `${S}.messages`);
  if (sql.includes('public.')) throw new Error(`donusum eksik (public. kaldi): ${dosya}`);
  return sql.trim();
}

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';
const D = 'dddddddd-0000-4000-8000-000000000004';
const M_AB = 'abababab-0000-4000-8000-0000000000ab';
const M_BC = 'bcbcbcbc-0000-4000-8000-0000000000bc';
// Pasif (unmatch/engelleme/ban sonrasi) eslesme: A-D. Sunucu bunu listelemez, sohbetine MATCH_INACTIVE der.
const M_AD = 'adadadad-0000-4000-8000-0000000000ad';

// Veri: matches AB (aktif), BC (aktif), AD (PASIF).
//       messages AB: 2 normal + 1 SILINMIS (deleted_at), BC: 1 normal, AD: 1 normal (pasif eslesmede).

// [etiket, rol, sub | null, beklenen matches, beklenen messages] ; -1 = yetki reddi beklenir
const VAKALAR: Array<[string, 'authenticated' | 'anon', string | null, number, number]> = [
  ['A (AB aktif; AD pasif; AB silinmis mesaj gizli)', 'authenticated', A, 1, 2],
  ['B (AB + BC aktif; silinmis mesaj gizli)', 'authenticated', B, 2, 3],
  ['C (yalniz BC)', 'authenticated', C, 1, 1],
  ['D (yalniz pasif AD: eslesme ve mesaji gizli)', 'authenticated', D, 0, 0],
  ['authenticated sub yok', 'authenticated', null, 0, 0],
  ['anon (publishable anahtar)', 'anon', null, -1, -1],
];

const migrationSql = MIGRATIONS.map(govde).join('\n');
const dollar = (s: string) => `$m$${s}$m$`;

const vakaSql = VAKALAR.map(([etiket, rol, sub, bekMatch, bekMsg]) => {
  const claims = JSON.stringify(sub ? { role: rol, sub, aud: 'authenticated' } : { role: rol });
  return `
  PERFORM set_config('request.jwt.claims', '${claims}', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  EXECUTE 'SET LOCAL ROLE ${rol}';
  BEGIN
    SELECT count(*) INTO n_match FROM ${S}.matches;
  EXCEPTION WHEN insufficient_privilege THEN n_match := -1; END;
  BEGIN
    SELECT count(*) INTO n_msg FROM ${S}.messages;
  EXCEPTION WHEN insufficient_privilege THEN n_msg := -1; END;
  RESET ROLE;
  ok := n_match = ${bekMatch} AND n_msg = ${bekMsg};
  IF NOT ok THEN hepsi := false; END IF;
  rapor := rapor || format(E'\\n%s | ${etiket} | matches=%s (beklenen ${bekMatch}) messages=%s (beklenen ${bekMsg})',
    CASE WHEN ok THEN 'GECTI' ELSE 'KALDI' END, n_match, n_msg);`;
}).join('\n');

console.log(`DO $do$
DECLARE
  n_match bigint; n_msg bigint; ok boolean; hepsi boolean := true; rapor text := '';
BEGIN
  CREATE SCHEMA ${S};
  CREATE TABLE ${S}.matches (LIKE public.matches INCLUDING DEFAULTS);
  CREATE TABLE ${S}.messages (LIKE public.messages INCLUDING DEFAULTS);
  GRANT USAGE ON SCHEMA ${S} TO anon, authenticated;
  -- Bugunku hal (2026-11-09 canli ACL): anon + authenticated tablo seviyesinde SELECT, RLS kapali.
  GRANT SELECT ON ${S}.matches, ${S}.messages TO anon, authenticated;

  INSERT INTO ${S}.matches (id, user1_id, user2_id, is_active) VALUES
    ('${M_AB}', '${A}', '${B}', true), ('${M_BC}', '${B}', '${C}', true), ('${M_AD}', '${A}', '${D}', false);
  INSERT INTO ${S}.messages (match_id, sender_id, content, deleted_at) VALUES
    ('${M_AB}', '${A}', 'x', NULL), ('${M_AB}', '${B}', 'y', NULL), ('${M_AB}', '${A}', 'silindi', now()),
    ('${M_BC}', '${C}', 'z', NULL), ('${M_AD}', '${D}', 'pasif', NULL);

  -- Migration govdeleri (082 sonra 083), dosyadan:
  EXECUTE ${dollar(migrationSql)};
${vakaSql}

  RAISE EXCEPTION 'SONUC %%', CASE WHEN hepsi THEN 'HEPSI_GECTI' ELSE 'KALAN_VAR' END || rapor;
END
$do$;`.replace('%%', '%'));
