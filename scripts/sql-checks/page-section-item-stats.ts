/**
 * `page_section_item_stats` SQL senaryo sinamasi (gercek Postgres, HICBIR SEY KALICI OLMAZ).
 *
 * Neden: backoffice olcum tablosu gecmisi JS'te taramaz (maliyet bekcisi); sayim kurallari SQL'de.
 * vitest RPC'yi sahte satirla besler, bu kurallari sinayamaz. Desen `match-list-summaries.ts` ile ayni:
 * gecici sema + fonksiyonun migration'daki govdesi (dosyadan okunur) + senaryolar + karsilastirma,
 * sonda HER ZAMAN `RAISE EXCEPTION 'SINAMA_RAPORU …'` (blogun tamami geri alinir).
 *
 * Kullanim:
 *   npx tsx scripts/sql-checks/page-section-item-stats.ts > /tmp/sinama.sql
 * Ciktiyi Supabase SQL editor'unde ya da MCP `execute_sql` ile calistir. Beklenen hata mesaji:
 *   SINAMA_RAPORU {"eksik": [], "fazla": [], "satir_sayisi": 3}
 */
import { KOK, migrationSec, fonksiyonGovdesi } from './ortak.js';

const SEMA = 'sinama';
const FONKSIYON = 'page_section_item_stats';
const T = `${SEMA}.`;
const u = (n: number) => `${T}u(${n})`;

// Kimlikler: kullanicilar 1..3, bolumler 0x100.., kartlar 0x200.., talepler 0x300..
const S_CANLI = 0x100, S_SILINMIS = 0x101, S_BASKA_SAYFA = 0x102;
const K1 = 0x200, K2 = 0x201, K3 = 0x202, K4 = 0x203;
const SINCE = '2026-09-21 00:00:00+00';

const migration = migrationSec(FONKSIYON);

process.stdout.write(`-- page_section_item_stats sinamasi — kaynak: ${migration.slice(KOK.length + 1)}
-- Blok HER ZAMAN SINAMA_RAPORU istisnasiyla biter (geri alinir).
DO $sinama$
DECLARE
  rapor jsonb;
BEGIN
  CREATE SCHEMA ${SEMA};
  CREATE FUNCTION ${T}u(n bigint) RETURNS uuid LANGUAGE sql IMMUTABLE AS $u$ SELECT ('00000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid $u$;
  CREATE TABLE ${T}page_sections (id uuid PRIMARY KEY, page_key text NOT NULL, deleted_at timestamptz);
  CREATE TABLE ${T}page_section_items (id uuid PRIMARY KEY, section_id uuid NOT NULL);
  CREATE TABLE ${T}page_section_events (item_id uuid NOT NULL, user_id uuid NOT NULL, event text NOT NULL,
    country text, platform text, day date NOT NULL);
  CREATE TABLE ${T}reward_redemptions (id uuid PRIMARY KEY, source_item_id uuid, country_code text NOT NULL,
    platform text, created_at timestamptz NOT NULL);

  ${fonksiyonGovdesi(migration, FONKSIYON, SEMA)}

  INSERT INTO ${T}page_sections VALUES
    (${u(S_CANLI)}, 'rewards_market', NULL),
    (${u(S_SILINMIS)}, 'rewards_market', '2026-09-25 00:00+00'),
    (${u(S_BASKA_SAYFA)}, 'baska_sayfa', NULL);
  INSERT INTO ${T}page_section_items VALUES
    (${u(K1)}, ${u(S_CANLI)}), (${u(K2)}, ${u(S_CANLI)}), (${u(K3)}, ${u(S_SILINMIS)}), (${u(K4)}, ${u(S_BASKA_SAYFA)});
  INSERT INTO ${T}page_section_events VALUES
    (${u(K1)}, ${u(1)}, 'impression', 'TH', 'android', '2026-09-27'),
    (${u(K1)}, ${u(2)}, 'impression', 'TH', 'android', '2026-09-28'),
    (${u(K1)}, ${u(1)}, 'click',      'TH', 'android', '2026-09-27'),
    (${u(K1)}, ${u(3)}, 'impression', 'ID', 'ios',     '2026-09-21'),  -- since gunu DAHIL
    (${u(K2)}, ${u(1)}, 'impression', 'TH', 'android', '2026-09-20'),  -- since oncesi: sayilmaz
    (${u(K3)}, ${u(1)}, 'impression', 'TH', 'android', '2026-09-27'),  -- silinmis bolum: sayilmaz
    (${u(K4)}, ${u(1)}, 'click',      'TH', 'android', '2026-09-27');  -- baska sayfa: sayilmaz
  INSERT INTO ${T}reward_redemptions VALUES
    (${u(0x300)}, ${u(K1)}, 'TH', 'android', '2026-09-27 10:00+00'),
    (${u(0x301)}, ${u(K1)}, 'MY', NULL,      '2026-09-26 10:00+00'),   -- platform NULL kendi grubunda
    (${u(0x302)}, ${u(K2)}, 'TH', 'android', '2026-09-20 23:59+00'),   -- since oncesi: sayilmaz
    (${u(0x303)}, NULL,     'TH', 'android', '2026-09-27 10:00+00'),   -- kaynaksiz: sayilmaz
    (${u(0x304)}, ${u(K3)}, 'TH', 'android', '2026-09-27 10:00+00');   -- silinmis bolum: sayilmaz

  WITH gercek AS (
    SELECT to_jsonb(s) AS satir FROM ${T}page_section_item_stats('rewards_market', '${SINCE}') s
  ), beklenen(satir) AS (
    VALUES
    (jsonb_build_object('item_id', ${u(K1)}, 'country', 'TH', 'platform', 'android', 'impressions', 2, 'clicks', 1, 'redemptions', 1)),
    (jsonb_build_object('item_id', ${u(K1)}, 'country', 'ID', 'platform', 'ios', 'impressions', 1, 'clicks', 0, 'redemptions', 0)),
    (jsonb_build_object('item_id', ${u(K1)}, 'country', 'MY', 'platform', NULL, 'impressions', 0, 'clicks', 0, 'redemptions', 1))
  )
  SELECT jsonb_build_object(
    'satir_sayisi', (SELECT count(*) FROM gercek),
    'eksik', (SELECT coalesce(jsonb_agg(b.satir), '[]') FROM beklenen b WHERE b.satir NOT IN (SELECT satir FROM gercek)),
    'fazla', (SELECT coalesce(jsonb_agg(g.satir), '[]') FROM gercek g WHERE g.satir NOT IN (SELECT satir FROM beklenen))
  ) INTO rapor;

  RAISE EXCEPTION 'SINAMA_RAPORU %', rapor;
END
$sinama$;
`);
