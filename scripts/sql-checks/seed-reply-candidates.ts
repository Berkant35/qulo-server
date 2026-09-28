/**
 * `seed_reply_candidates` SQL senaryo sinamasi (gercek Postgres, HICBIR SEY KALICI OLMAZ).
 *
 * Neden: tarama tek RPC'ye tasininca (migration 065) "silinmis mesaj son sayilmaz", "pasif
 * eslesme", "is_test_account=false seed", "acik kuyruk satiri", "kapanis" gibi kurallar SQL'e
 * gecti; vitest RPC'yi sahte satirla besler, bu kurallari sinayamaz. Test DB'si yok (ucretli),
 * bu yuzden sinama tek bir DO blogu: gecici `sinama` semasi + tablolar + fonksiyonun migration'daki
 * govdesi (elle kopya YOK, dosyadan okunur) + senaryolar + karsilastirma, ve sonda HER ZAMAN
 * `RAISE EXCEPTION 'SINAMA_RAPORU …'` — istisna blogun tamamini (DDL dahil) geri alir, prod'da
 * bile iz kalmaz. Tablo adlari hep semayla nitelenir (search_path'e guvenilmez).
 *
 * Kullanim:
 *   npx tsx scripts/sql-checks/seed-reply-candidates.ts > /tmp/sinama.sql      # en son migration
 *   npx tsx scripts/sql-checks/seed-reply-candidates.ts --migration migrations/065_seed_reply_candidates.sql
 * Ciktiyi Supabase SQL editor'unde ya da MCP `execute_sql` ile calistir. Beklenen hata mesaji:
 *   SINAMA_RAPORU {"eksik": [], "fazla": [], "aday_sayisi": N, "alan_hatasi": []}
 * Fonksiyonu degistiren her migration'da calistir; yeni kural = yeni senaryo.
 */
import { KOK, migrationSec, fonksiyonGovdesi, q } from './ortak.js';

const SEMA = 'sinama';
const FONKSIYON = 'seed_reply_candidates';

// --- kimlikler: SQL'de `sinama.u(n)` = 00000000-0000-4000-8000-<n hex>, `sinama.t(dk)` = 10:00 + dk ---
const S1 = 0x51, S2 = 0x52, S3 = 0x53, H1 = 0xa1, H2 = 0xa2;   // seed'ler (S2: is_test_account=false), insanlar
const M = (k: number) => 0x1000 + k;                              // eslesme
const MSG = (k: number, i: number) => 0x200000 + k * 100 + i;    // mesaj
const u = (n: number) => `${SEMA}.u(${n})`;

const eslesmeler: string[] = [];
const mesajlar: string[] = [];
const diziler: string[] = [];
const sorular: string[] = [];
const medyalar: string[] = [];
const kuyruklar: string[] = [];

const esl = (k: number, a: number, b: number, aktif = true) => eslesmeler.push(`(${M(k)}, ${a}, ${b}, ${aktif})`);
const msj = (k: number, i: number, gonderen: number, icerik = 'selam', silindi = false) =>
  mesajlar.push(`(${MSG(k, i)}, ${M(k)}, ${gonderen}, ${q(icerik)}, ${silindi}, ${i})`);
/** n mesajlik dizi (dakika = indeks); seedTek: seed tek indekslerde mi. Kimlik MSG(k, i) formulu. */
const dizi = (k: number, n: number, seedTek: boolean, seed: number, insan: number) => diziler.push(
  `INSERT INTO ${SEMA}.messages SELECT ${SEMA}.u(${MSG(k, 0)} + i), ${u(M(k))}, ` +
  `${SEMA}.u(CASE WHEN (i % 2 = 1) = ${seedTek} THEN ${seed} ELSE ${insan} END), 'selam', NULL, ${SEMA}.t(i) ` +
  `FROM generate_series(0, ${n - 1}) i;`);
const soru = (id: number, k: number, gonderen: number, dk: number, cevap: string | null = null, terk: boolean | null = false) =>
  sorular.push(`(${id}, ${M(k)}, ${gonderen}, ${q(cevap)}, ${terk === null ? 'NULL::boolean' : terk}, ${dk})`);
const medya = (id: number, k: number, isteyen: number, durum: string, dk: number) =>
  medyalar.push(`(${id}, ${M(k)}, ${isteyen}, ${q(durum)}, ${dk})`);
const kuyruk = (k: number, durum: string) => kuyruklar.push(`(${M(k)}, ${q(durum)})`);

/** Beklenen adaylar: yalniz verilen alanlar karsilastirilir (jsonb @>); null = "NULL olmali"; kimlikler U(n). */
type Deger = number | boolean | string | null | { id: number };
const beklenen: string[] = [];
const U = (id: number) => ({ id });
const bekle = (k: number, alanlar: Record<string, Deger>) => {
  const ciftler = Object.entries(alanlar).map(([anahtar, v]) => {
    const sql = v === null ? 'NULL::text'
      : typeof v === 'object' ? u(v.id)
      : typeof v === 'string' ? q(v)
      : String(v);
    return `'${anahtar}', ${sql}`;
  });
  beklenen.push(`(${u(M(k))}, jsonb_build_object(${ciftler.join(', ')}))`);
};

// --- senaryolar (aday DONMEYENLER de sinanir: `fazla` listesi) ---
esl(0x0a, S1, H1); msj(0x0a, 0, S1); msj(0x0a, 1, H1);                       // insan son → ADAY
bekle(0x0a, { seed_user_id: U(S1), message_count: 2, last_message_id: U(MSG(0x0a, 1)), last_message_is_question: false, kapanis_gonderildi: false, pending_question_id: null, pending_media_request_id: null, tip: 's1' });
esl(0x0b, S1, H2); msj(0x0b, 0, H2); msj(0x0b, 1, S1);                       // bot son → yok
esl(0x0c, H1, S3); msj(0x0c, 0, S3); msj(0x0c, 1, H1, 'selam', true);        // insanin son mesaji silinmis → yok
esl(0x0d, S1, H1, false); msj(0x0d, 0, S1); msj(0x0d, 1, H1);                // pasif → yok
esl(0x0e, S2, H1); msj(0x0e, 0, H1);                                         // is_test_account=false seed → yok
esl(0x0f, S1, H2); msj(0x0f, 0, H2); kuyruk(0x0f, 'pending');                // acik satir → yok
esl(0x1f, S1, H2); msj(0x1f, 0, H2); kuyruk(0x1f, 'claimed');                // acik satir → yok
esl(0x10, S1, H1); msj(0x10, 0, H1); kuyruk(0x10, 'failed');                 // failed acik sayilmaz → ADAY (soguma JS'te)
bekle(0x10, { seed_user_id: U(S1), message_count: 1, last_message_id: U(MSG(0x10, 0)) });
esl(0x11, S1, H1); msj(0x11, 0, H1, '__QUESTION__:abc');                     // insan soru karti son → yok
esl(0x12, S1, H1); msj(0x12, 0, H1); msj(0x12, 1, S1); soru(0xc012, 0x12, H1, 5);   // insanin cevapsiz sorusu → ADAY
bekle(0x12, { seed_user_id: U(S1), last_message_id: U(MSG(0x12, 1)), pending_question_id: U(0xc012), pending_question_sender_id: U(H1), pending_media_request_id: null });
esl(0x13, S1, H1); msj(0x13, 0, S1, '__QUESTION__:x'); soru(0xc013, 0x13, S1, 5);   // botun kendi sorusu → yok
esl(0x14, S1, H1); msj(0x14, 0, H1); msj(0x14, 1, S1);                       // terk edilmis + cevaplanmis soru → yok
soru(0xc014a, 0x14, H1, 5, null, true); soru(0xc014b, 0x14, H1, 5, 'A');
esl(0x15, S1, H1); msj(0x15, 0, H1); msj(0x15, 1, S1); soru(0xc015, 0x15, H1, 5, null, null); // is_abandoned NULL → yok
esl(0x16, S1, H1); msj(0x16, 0, H1); msj(0x16, 1, S1);                       // en yeni pending medya → ADAY
medya(0xd016a, 0x16, H1, 'pending', 2); medya(0xd016b, 0x16, H1, 'pending', 3); medya(0xd016c, 0x16, H1, 'declined', 4);
bekle(0x16, { seed_user_id: U(S1), pending_media_request_id: U(0xd016b), pending_media_requester_id: U(H1), pending_question_id: null });
esl(0x17, S1, H1); msj(0x17, 0, H1); msj(0x17, 1, S1); medya(0xd017, 0x17, S1, 'pending', 2); // botun kendi istegi → yok
esl(0x18, S1, H1); dizi(0x18, 27, true, S1, H1);                             // 27 mesaj, seed 25. indekste (kapanis) → yok
esl(0x19, H2, S3); dizi(0x19, 26, false, S3, H2);                            // 26 mesaj kapanissiz, seed user2 → ADAY
bekle(0x19, { seed_user_id: U(S3), message_count: 26, last_message_id: U(MSG(0x19, 25)), kapanis_gonderildi: false, tip: 's3' });
esl(0x1a, S1, H1); dizi(0x1a, 27, true, S1, H1); soru(0xc01a, 0x1a, H1, 30); // kapanis + insan sorusu → ADAY
bekle(0x1a, { seed_user_id: U(S1), message_count: 27, kapanis_gonderildi: true, pending_question_id: U(0xc01a) });
esl(0x1b, S1, H1);                                                           // mesajsiz → yok
esl(0x1c, S1, S3); msj(0x1c, 0, S1); msj(0x1c, 1, S3);                       // seed-seed: user1 seed sayilir → ADAY (eski JS paritesi)
bekle(0x1c, { seed_user_id: U(S1), last_message_id: U(MSG(0x1c, 1)) });
esl(0x1d, S1, H1); msj(0x1d, 0, S1); msj(0x1d, 1, H1); msj(0x1d, 2, H1, 'sil', true); // son silinmis, oncesi insan → ADAY
bekle(0x1d, { seed_user_id: U(S1), message_count: 2, last_message_id: U(MSG(0x1d, 1)) });
// 066: botun YENI bekleyen sorusu insanin ESKI kilitsiz sorusunu gizlemez (createQuestion yalniz kilitte durur).
esl(0x1e, S1, H1); msj(0x1e, 0, H1, '__QUESTION__:qh'); msj(0x1e, 1, S1, '__QUESTION__:qs');
soru(0xc01e1, 0x1e, H1, 0.2); soru(0xc01e2, 0x1e, S1, 1.2);
bekle(0x1e, { seed_user_id: U(S1), pending_question_id: U(0xc01e1), pending_question_sender_id: U(H1) });
// Ayna: botun ESKI sorusu insanin YENI sorusunu gizlemez (eski JS'in ORDER'siz limit(1) hatasi).
esl(0x20, S1, H1); msj(0x20, 0, S1, '__QUESTION__:qs'); msj(0x20, 1, H1, '__QUESTION__:qh');
soru(0xc0201, 0x20, S1, 0.2); soru(0xc0202, 0x20, H1, 1.2);
bekle(0x20, { seed_user_id: U(S1), pending_question_id: U(0xc0202), pending_question_sender_id: U(H1) });
// Insanin iki bekleyen sorusu: EN ESKISI once (FIFO).
esl(0x21, S1, H1); msj(0x21, 0, H1); msj(0x21, 1, S1); soru(0xc0211, 0x21, H1, 2); soru(0xc0212, 0x21, H1, 3);
bekle(0x21, { seed_user_id: U(S1), pending_question_id: U(0xc0211) });
// Medya simetrisi: botun yeni istegi insanin eski istegini gizlemez.
esl(0x22, S1, H1); msj(0x22, 0, H1); msj(0x22, 1, S1); medya(0xd0221, 0x22, H1, 'pending', 2); medya(0xd0222, 0x22, S1, 'pending', 3);
bekle(0x22, { seed_user_id: U(S1), pending_media_request_id: U(0xd0221), pending_media_requester_id: U(H1) });

const migration = migrationSec(FONKSIYON);
const T = `${SEMA}.`;

process.stdout.write(`-- seed_reply_candidates sinamasi — kaynak: ${migration.slice(KOK.length + 1)}
-- ${eslesmeler.length} eslesme senaryosu, ${beklenen.length} beklenen aday. Blok HER ZAMAN SINAMA_RAPORU istisnasiyla biter (geri alinir).
DO $sinama$
DECLARE
  rapor jsonb;
BEGIN
  CREATE SCHEMA ${SEMA};
  CREATE FUNCTION ${T}u(n bigint) RETURNS uuid LANGUAGE sql IMMUTABLE AS $u$ SELECT ('00000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid $u$;
  CREATE FUNCTION ${T}t(dk numeric) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $t$ SELECT timestamptz '2026-09-27 10:00:00+00' + dk * interval '1 minute' $t$;
  CREATE TABLE ${T}users (id uuid PRIMARY KEY, is_seed_profile boolean NOT NULL DEFAULT false, is_test_account boolean NOT NULL DEFAULT false, seed_persona jsonb);
  CREATE TABLE ${T}matches (id uuid PRIMARY KEY, user1_id uuid NOT NULL, user2_id uuid NOT NULL, is_active boolean NOT NULL DEFAULT true);
  CREATE TABLE ${T}messages (id uuid PRIMARY KEY, match_id uuid NOT NULL, sender_id uuid NOT NULL, content text NOT NULL, deleted_at timestamptz, created_at timestamptz NOT NULL);
  CREATE TABLE ${T}chat_questions (id uuid PRIMARY KEY, match_id uuid NOT NULL, sender_id uuid NOT NULL, answered_option character(1), is_abandoned boolean DEFAULT false, created_at timestamptz NOT NULL);
  CREATE TABLE ${T}media_requests (id uuid PRIMARY KEY, match_id uuid NOT NULL, requester_id uuid NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL);
  CREATE TABLE ${T}seed_reply_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), match_id uuid NOT NULL, status text NOT NULL);

  ${fonksiyonGovdesi(migration, FONKSIYON, SEMA)}

  INSERT INTO ${T}users VALUES (${u(S1)}, true, true, '{"tip":"s1"}'), (${u(S2)}, true, false, '{"tip":"s2"}'),
    (${u(S3)}, true, true, '{"tip":"s3"}'), (${u(H1)}, false, false, NULL), (${u(H2)}, false, false, NULL);
  INSERT INTO ${T}matches SELECT ${T}u(m), ${T}u(a), ${T}u(b), aktif FROM (VALUES
    ${eslesmeler.join(',\n    ')}) v(m, a, b, aktif);
  INSERT INTO ${T}messages SELECT ${T}u(id), ${T}u(m), ${T}u(s), c, CASE WHEN sil THEN ${T}t(dk + 0.5) END, ${T}t(dk) FROM (VALUES
    ${mesajlar.join(',\n    ')}) v(id, m, s, c, sil, dk);
  ${diziler.join('\n  ')}
  INSERT INTO ${T}chat_questions SELECT ${T}u(id), ${T}u(m), ${T}u(s), cevap::character(1), terk, ${T}t(dk) FROM (VALUES
    ${sorular.join(',\n    ')}) v(id, m, s, cevap, terk, dk);
  INSERT INTO ${T}media_requests SELECT ${T}u(id), ${T}u(m), ${T}u(s), durum, ${T}t(dk) FROM (VALUES
    ${medyalar.join(',\n    ')}) v(id, m, s, durum, dk);
  INSERT INTO ${T}seed_reply_queue (match_id, status) SELECT ${T}u(m), durum FROM (VALUES
    ${kuyruklar.join(',\n    ')}) v(m, durum);

  WITH gercek AS (
    SELECT c.match_id, to_jsonb(c) || jsonb_build_object('tip', c.seed_persona->>'tip') AS satir
      FROM ${T}seed_reply_candidates(25) c
  ), beklenen(match_id, alanlar) AS (
    VALUES
    ${beklenen.join(',\n    ')}
  )
  SELECT jsonb_build_object(
    'aday_sayisi', (SELECT count(*) FROM gercek),
    'eksik', (SELECT coalesce(jsonb_agg(b.match_id), '[]') FROM beklenen b WHERE b.match_id NOT IN (SELECT match_id FROM gercek)),
    'fazla', (SELECT coalesce(jsonb_agg(g.match_id), '[]') FROM gercek g WHERE g.match_id NOT IN (SELECT match_id FROM beklenen)),
    'alan_hatasi', (SELECT coalesce(jsonb_agg(jsonb_build_object('match', b.match_id, 'beklenen', b.alanlar, 'gelen', g.satir)), '[]')
                      FROM beklenen b JOIN gercek g USING (match_id) WHERE NOT (g.satir @> b.alanlar))
  ) INTO rapor;

  RAISE EXCEPTION 'SINAMA_RAPORU %', rapor;
END
$sinama$;
`);
