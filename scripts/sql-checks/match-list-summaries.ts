/**
 * `match_list_summaries` SQL senaryo sinamasi (gercek Postgres, HICBIR SEY KALICI OLMAZ).
 *
 * Neden: eslesme listesinin son mesaj / okunmamis kurallari migration 070'te SQL'e gecti; vitest
 * RPC'yi sahte satirla besler, bu kurallari sinayamaz. Desen `seed-reply-candidates.ts` ile ayni:
 * gecici sema + fonksiyonun migration'daki govdesi (dosyadan okunur) + senaryolar + karsilastirma,
 * sonda HER ZAMAN `RAISE EXCEPTION 'SINAMA_RAPORU …'` (blogun tamami geri alinir).
 *
 * Kullanim:
 *   npx tsx scripts/sql-checks/match-list-summaries.ts > /tmp/sinama.sql
 * Ciktiyi Supabase SQL editor'unde ya da MCP `execute_sql` ile calistir. Beklenen hata mesaji:
 *   SINAMA_RAPORU {"eksik": [], "fazla": [], "alan_hatasi": [], "satir_sayisi": 7}
 */
import { KOK, migrationSec, fonksiyonGovdesi, q } from './ortak.js';

const SEMA = 'sinama';
const FONKSIYON = 'match_list_summaries';
const T = `${SEMA}.`;
const u = (n: number) => `${T}u(${n})`;

// --- kimlikler: izleyen V, karsi taraflar A/B/C ---
const V = 0x01, A = 0x0a, B = 0x0b, C = 0x0c;
const M = (k: number) => 0x1000 + k;
let mesajNo = 0x200000;

const eslesmeler: string[] = [];
const mesajlar: string[] = [];
const istenen: number[] = [];
const beklenen: string[] = [];

const esl = (k: number, a: number, b: number, iste = true) => {
  eslesmeler.push(`(${M(k)}, ${a}, ${b})`);
  if (iste) istenen.push(M(k));
};
/** dk: dakika (10:00 + dk); okundu/silindi: o mesaj icin read_at/deleted_at dolu mu. */
const msj = (k: number, gonderen: number, dk: number, icerik: string,
  o: { resim?: boolean; ses?: string; okundu?: boolean; silindi?: boolean } = {}) =>
  mesajlar.push(`(${mesajNo++}, ${M(k)}, ${gonderen}, ${q(icerik)}, ${o.resim ?? false}, ${q(o.ses ?? null)}, ` +
    `${o.okundu ?? false}, ${o.silindi ?? false}, ${dk})`);

type Deger = number | boolean | string | null | { id: number } | { dk: number };
const bekle = (k: number, alanlar: Record<string, Deger>) => {
  const ciftler = Object.entries(alanlar).map(([anahtar, v]) => {
    const sql = v === null ? 'NULL::text'
      : typeof v === 'object' ? ('id' in v ? u(v.id) : `${T}t(${v.dk})`)
      : typeof v === 'string' ? q(v)
      : String(v);
    return `'${anahtar}', ${sql}`;
  });
  beklenen.push(`(${u(M(k))}, jsonb_build_object(${ciftler.join(', ')}))`);
};

// --- senaryolar (DONMEMESI gerekenler `fazla` listesiyle sinanir) ---
// Silinmis en yeni mesaj son sayilmaz; silinmis okunmamis sayilmaz.
esl(1, V, A); msj(1, A, 1, 'ilk'); msj(1, V, 2, 'cevap', { okundu: false }); msj(1, A, 3, 'silinen', { silindi: true });
bekle(1, { content: 'cevap', sender_id: { id: V }, is_image: false, audio_url: null, created_at: { dk: 2 }, unread_count: 1 });
// Izleyen user2: okunmus resim sayilmaz; ses + metin okunmamis; son = en yeni metin.
esl(2, B, V); msj(2, B, 1, 'https://x/p.jpg', { resim: true, okundu: true }); msj(2, B, 2, 'ses', { ses: 'https://x/a.m4a' }); msj(2, B, 3, 'selam');
bekle(2, { content: 'selam', sender_id: { id: B }, unread_count: 2 });
// Son mesaj sesliyse alanlar tasinir (onizleme metni JS'te).
esl(3, V, C); msj(3, C, 1, 'Sesli mesaj', { ses: 'https://x/b.m4a' });
bekle(3, { audio_url: 'https://x/b.m4a', is_image: false, unread_count: 1 });
// Izleyenin kendi okunmamis mesaji sayilmaz.
esl(4, V, A); msj(4, V, 1, 'ben yazdim');
bekle(4, { content: 'ben yazdim', unread_count: 0 });
// Soru karti isareti ayiklanmaz (eski JS paritesi).
esl(5, V, B); msj(5, B, 2, '__QUESTION__:q1');
bekle(5, { content: '__QUESTION__:q1', unread_count: 1 });
// Mesajsiz eslesme de doner.
esl(6, V, C);
bekle(6, { content: null, sender_id: null, created_at: null, unread_count: 0 });
// Butun mesajlari silinmis: son mesaj NULL, okunmamis 0 — ama satir yine doner.
esl(7, V, A); msj(7, A, 1, 'a', { silindi: true }); msj(7, A, 2, 'b', { silindi: true });
bekle(7, { content: null, unread_count: 0 });
// Izleyenin taraf OLMADIGI eslesme id listede olsa bile donmez (sizinti yok).
esl(8, A, B); msj(8, A, 1, 'gizli');
// Listede istenmeyen eslesme donmez.
esl(9, V, B, false); msj(9, B, 1, 'istenmedi');

const migration = migrationSec(FONKSIYON);

process.stdout.write(`-- match_list_summaries sinamasi — kaynak: ${migration.slice(KOK.length + 1)}
-- ${eslesmeler.length} eslesme senaryosu, ${beklenen.length} beklenen satir. Blok HER ZAMAN SINAMA_RAPORU istisnasiyla biter (geri alinir).
DO $sinama$
DECLARE
  rapor jsonb;
BEGIN
  CREATE SCHEMA ${SEMA};
  CREATE FUNCTION ${T}u(n bigint) RETURNS uuid LANGUAGE sql IMMUTABLE AS $u$ SELECT ('00000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid $u$;
  CREATE FUNCTION ${T}t(dk numeric) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $t$ SELECT timestamptz '2026-09-28 10:00:00+00' + dk * interval '1 minute' $t$;
  CREATE TABLE ${T}matches (id uuid PRIMARY KEY, user1_id uuid NOT NULL, user2_id uuid NOT NULL);
  CREATE TABLE ${T}messages (id uuid PRIMARY KEY, match_id uuid NOT NULL, sender_id uuid NOT NULL, content text NOT NULL,
    is_image boolean NOT NULL DEFAULT false, audio_url text, read_at timestamptz, deleted_at timestamptz, created_at timestamptz NOT NULL);

  ${fonksiyonGovdesi(migration, FONKSIYON, SEMA)}

  INSERT INTO ${T}matches SELECT ${T}u(m), ${T}u(a), ${T}u(b) FROM (VALUES
    ${eslesmeler.join(',\n    ')}) v(m, a, b);
  INSERT INTO ${T}messages SELECT ${T}u(id), ${T}u(m), ${T}u(s), c, resim, ses,
      CASE WHEN okundu THEN ${T}t(dk + 0.5) END, CASE WHEN sil THEN ${T}t(dk + 0.5) END, ${T}t(dk) FROM (VALUES
    ${mesajlar.join(',\n    ')}) v(id, m, s, c, resim, ses, okundu, sil, dk);

  WITH gercek AS (
    SELECT s.match_id, to_jsonb(s) AS satir
      FROM ${T}match_list_summaries(${u(V)}, ARRAY[${istenen.map(u).join(', ')}]) s
  ), beklenen(match_id, alanlar) AS (
    VALUES
    ${beklenen.join(',\n    ')}
  )
  SELECT jsonb_build_object(
    'satir_sayisi', (SELECT count(*) FROM gercek),
    'eksik', (SELECT coalesce(jsonb_agg(b.match_id), '[]') FROM beklenen b WHERE b.match_id NOT IN (SELECT match_id FROM gercek)),
    'fazla', (SELECT coalesce(jsonb_agg(g.match_id), '[]') FROM gercek g WHERE g.match_id NOT IN (SELECT match_id FROM beklenen)),
    'alan_hatasi', (SELECT coalesce(jsonb_agg(jsonb_build_object('match', b.match_id, 'beklenen', b.alanlar, 'gelen', g.satir)), '[]')
                      FROM beklenen b JOIN gercek g USING (match_id) WHERE NOT (g.satir @> b.alanlar))
  ) INTO rapor;

  RAISE EXCEPTION 'SINAMA_RAPORU %', rapor;
END
$sinama$;
`);
