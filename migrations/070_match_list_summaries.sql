-- 070_match_list_summaries.sql
-- Eslesme listesi (GET /matches) son mesaj + okunmamis sayisi TEK sorguda (2026-09-28 maliyet incelemesi).
--
-- Eskiden `getMatches` son mesaji bulmak icin kullanicinin TUM eslesmelerindeki TUM mesajlari
-- (created_at DESC) cekip JS'te eslesme basina ilkini seciyordu; okunmamislar icin de her okunmamis
-- mesaj ayri satir geliyordu. Iki sorun:
--   1) cevap boyutu sohbet gecmisiyle sinirsiz buyur (egress, kullanici sayisiyla carpilir);
--   2) PostgREST max-rows (1000) sonrasini sessizce keser — eski bir sohbetin son mesaji ve
--      okunmamis sayisi kaybolur; `.in()` ile uzun id listesi URL sinirina da takilir.
-- Bu fonksiyon eslesme basina TEK satir dondurur (idx_messages_match, idx_messages_unread).
--
-- Sozlesme (JS eski davranisla ayni; SQL gercek Postgres'te geri alinan islemde senaryolarla
-- sinandi — `npx tsx scripts/sql-checks/match-list-summaries.ts`):
--   * yalniz p_user_id'nin taraf oldugu eslesmeler doner: yanlis id listesi baskasinin ozetini sizdirmaz
--   * son mesaj = SILINMEMIS en yeni mesaj; soru karti isareti dahil (eski JS de ayiklamiyordu)
--   * okunmamis = karsi tarafin read_at NULL ve silinmemis mesajlari
--   * mesaji olmayan eslesme de doner: son mesaj alanlari NULL, okunmamis 0
--
-- Erisim: SECURITY INVOKER + EXECUTE yalniz service_role (seed_reply_candidates ile ayni desen).
--
-- SIRA: ONCE bu migration, SONRA kod (matching.service.ts getMatches). Kod once giderse eslesme
-- listesi calisir ama son mesaj onizlemesi ve okunmamis sayilari bos gelir (log: match_list_summaries).

BEGIN;

CREATE OR REPLACE FUNCTION match_list_summaries(p_user_id uuid, p_match_ids uuid[])
RETURNS TABLE (
  match_id      uuid,
  content       text,
  sender_id     uuid,
  is_image      boolean,
  audio_url     text,
  created_at    timestamptz,
  unread_count  integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT m.id,
         son.content, son.sender_id, son.is_image, son.audio_url, son.created_at,
         okunmamis.adet::integer
    FROM matches m
    LEFT JOIN LATERAL (
      SELECT x.content, x.sender_id, x.is_image, x.audio_url, x.created_at
        FROM messages x
       WHERE x.match_id = m.id
         AND x.deleted_at IS NULL
       ORDER BY x.created_at DESC, x.id DESC
       LIMIT 1
    ) son ON true
    CROSS JOIN LATERAL (
      SELECT count(*) AS adet
        FROM messages y
       WHERE y.match_id = m.id
         AND y.sender_id <> p_user_id
         AND y.read_at IS NULL
         AND y.deleted_at IS NULL
    ) okunmamis
   WHERE m.id = ANY (p_match_ids)
     AND (m.user1_id = p_user_id OR m.user2_id = p_user_id);
$$;

COMMENT ON FUNCTION match_list_summaries(uuid, uuid[]) IS
  'GET /matches: eslesme basina son (silinmemis) mesaj + okunmamis sayisi; yalniz p_user_id tarafi olan eslesmeler. Migration 070.';

REVOKE ALL ON FUNCTION match_list_summaries(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION match_list_summaries(uuid, uuid[]) TO service_role;

COMMIT;
