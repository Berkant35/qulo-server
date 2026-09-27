-- 065_seed_reply_candidates.sql
-- Seed AI sohbet taramasi TEK sorguda (2026-09-27 Supabase istek patlamasi).
--
-- Eskiden `scanAndEnqueue` her 10 sn'lik tikte 417 seed id'sini 100'luk parcalarla iki kolonda
-- arayip (10 istek) eslesme basina son mesaj + bekleyen soru okuyordu (N+1): tik basina ~39
-- istek, gunde ~337 bin — neredeyse hepsi "is yok" sonucu icin. Bu fonksiyon insandan gelen
-- bir tetikleyicisi olan seed eslesmelerini tek istekte dondurur; bostaki tikte 0 satir.
-- Tur / soguma / iptal / soru zari karari JS'te kalir (src/services/seed-reply.service.ts).
--
-- Sozlesme (JS testleri RPC'yi sahte satirla besler; bu SQL gercek Postgres'te, geri alinan
-- islemde senaryolarla sinandi — tasks/test-cases.md "seed_reply_candidates"):
--   * yalniz is_active eslesme; seed tarafi is_seed_profile AND is_test_account
--     (yazma kapisi `botYazabilir` ile ayni iki kolon; ikisi de seed ise user1)
--   * ACIK kuyruk satiri (pending/claimed) olan eslesme donmez — idx_seed_reply_queue_open_match
--   * son mesaj = SILINMEMIS en yeni mesaj; soru karti = content '__QUESTION__' ile baslar
--   * bekleyen soru = answered_option NULL ve is_abandoned = false (NULL sayilmaz, PostgREST .eq ile ayni)
--   * bekleyen medya = en yeni status 'pending' istek
--   * kapanis_gonderildi = seed'in p_kapanis_esik (0-tabanli) indeksinden sonra silinmemis mesaji var
--   * satir yalniz su uc tetikleyiciden biri varsa doner: insanin cevapsiz sorusu, insanin bekleyen
--     medya istegi ya da insanin soru karti olmayan son mesaji (kapanis gonderilmemisse)
--
-- Erisim: SECURITY INVOKER + EXECUTE yalniz service_role (claim_seed_replies ile ayni desen).

BEGIN;

CREATE OR REPLACE FUNCTION seed_reply_candidates(p_kapanis_esik int)
RETURNS TABLE (
  match_id                   uuid,
  seed_user_id               uuid,
  seed_persona               jsonb,
  message_count              int,
  last_message_id            uuid,
  last_message_sender_id     uuid,
  last_message_is_question   boolean,
  kapanis_gonderildi         boolean,
  pending_question_id        uuid,
  pending_question_sender_id uuid,
  pending_media_request_id   uuid,
  pending_media_requester_id uuid
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH eslesme AS (
    SELECT m.id AS match_id, s.id AS seed_user_id, s.seed_persona
      FROM matches m
      JOIN users u1 ON u1.id = m.user1_id
      JOIN users u2 ON u2.id = m.user2_id
     CROSS JOIN LATERAL (
       SELECT CASE WHEN u1.is_seed_profile AND u1.is_test_account THEN u1.id ELSE u2.id END AS id,
              CASE WHEN u1.is_seed_profile AND u1.is_test_account THEN u1.seed_persona ELSE u2.seed_persona END AS seed_persona
     ) s
     WHERE m.is_active
       AND ((u1.is_seed_profile AND u1.is_test_account) OR (u2.is_seed_profile AND u2.is_test_account))
       AND NOT EXISTS (
         SELECT 1 FROM seed_reply_queue q
          WHERE q.match_id = m.id AND q.status IN ('pending', 'claimed'))
  ),
  durum AS (
    SELECT e.match_id, e.seed_user_id, e.seed_persona,
           lm.id        AS last_message_id,
           lm.sender_id AS last_message_sender_id,
           coalesce(starts_with(lm.content, '__QUESTION__'), false) AS last_message_is_question,
           pq.id        AS pending_question_id,
           pq.sender_id AS pending_question_sender_id,
           pm.id           AS pending_media_request_id,
           pm.requester_id AS pending_media_requester_id
      FROM eslesme e
      LEFT JOIN LATERAL (
        SELECT x.id, x.sender_id, x.content
          FROM messages x
         WHERE x.match_id = e.match_id AND x.deleted_at IS NULL
         ORDER BY x.created_at DESC
         LIMIT 1
      ) lm ON true
      LEFT JOIN LATERAL (
        SELECT c.id, c.sender_id
          FROM chat_questions c
         WHERE c.match_id = e.match_id AND c.answered_option IS NULL AND c.is_abandoned = false
         ORDER BY c.created_at DESC
         LIMIT 1
      ) pq ON true
      LEFT JOIN LATERAL (
        SELECT r.id, r.requester_id
          FROM media_requests r
         WHERE r.match_id = e.match_id AND r.status = 'pending'
         ORDER BY r.created_at DESC
         LIMIT 1
      ) pm ON true
  ),
  -- Sayim ve kapanis yalniz tetikleyicisi olan (az sayidaki) eslesmede hesaplanir.
  tetikli AS (
    SELECT d.*,
           (d.pending_question_id IS NOT NULL AND d.pending_question_sender_id <> d.seed_user_id)
             OR (d.pending_media_request_id IS NOT NULL AND d.pending_media_requester_id <> d.seed_user_id)
             AS oncelikli
      FROM durum d
     WHERE (d.pending_question_id IS NOT NULL AND d.pending_question_sender_id <> d.seed_user_id)
        OR (d.pending_media_request_id IS NOT NULL AND d.pending_media_requester_id <> d.seed_user_id)
        OR (d.last_message_id IS NOT NULL AND d.last_message_sender_id <> d.seed_user_id
            AND NOT d.last_message_is_question)
  ),
  aday AS (
    SELECT t.*,
           (SELECT count(*)::int FROM messages x
             WHERE x.match_id = t.match_id AND x.deleted_at IS NULL) AS message_count,
           EXISTS (
             SELECT 1
               FROM (SELECT x.sender_id
                       FROM messages x
                      WHERE x.match_id = t.match_id AND x.deleted_at IS NULL
                      ORDER BY x.created_at
                     OFFSET p_kapanis_esik) sonrasi
              WHERE sonrasi.sender_id = t.seed_user_id
           ) AS kapanis_gonderildi
      FROM tetikli t
  )
  SELECT a.match_id, a.seed_user_id, a.seed_persona, a.message_count,
         a.last_message_id, a.last_message_sender_id, a.last_message_is_question, a.kapanis_gonderildi,
         a.pending_question_id, a.pending_question_sender_id,
         a.pending_media_request_id, a.pending_media_requester_id
    FROM aday a
   -- Kapanisi gonderilmis sohbet yalniz soru/medya tetikleyicisiyle doner: aksi halde her
   -- biten sohbet her tikte satir tasirdi (egress ve istek buyumesi).
   WHERE a.oncelikli OR NOT a.kapanis_gonderildi;
$$;

COMMENT ON FUNCTION seed_reply_candidates(int) IS
  'Seed AI cevap taramasi: insandan tetikleyicisi olan, acik kuyruk satiri olmayan seed eslesmeleri. Karar JS''te (seed-reply.service.ts scanAndEnqueue). Migration 065.';

REVOKE ALL ON FUNCTION seed_reply_candidates(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION seed_reply_candidates(int) TO service_role;

COMMIT;
