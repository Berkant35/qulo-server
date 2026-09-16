-- 059_seed_ai_sohbet.sql
-- Tohum (seed) profillerin gelen mesajlara karaktere uygun AI cevabi yazmasi.
-- Spec: docs/superpowers/specs/2026-09-16-seed-ai-sohbet-design.md
-- Kapi: seed profiller discover'da yalniz is_test_admin'e gorunur (matching.service.ts:175).
-- seed_reply_queue realtime publication'a EKLENMEZ; anon/authenticated grant verilmez.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS seed_persona JSONB;

COMMENT ON COLUMN users.seed_persona IS
  'Seed profilleri: AI sohbet kisilik karti. Sekil: { responder_type, work_pattern, sleep_window:{start_min,end_min}, style:{uzunluk,emoji,yazim,enerji}, derived_at, model }. Gercek kullanicida NULL.';

ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS seed_reply_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS seed_reply_fast_mode BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN app_config.seed_reply_enabled IS
  'Seed AI cevap cron kill-switch. Varsayilan kapali; her tick basinda okunur.';
COMMENT ON COLUMN app_config.seed_reply_fast_mode IS
  'Hizli test modu: tum cevap gecikmeleri saniyelere sikisir, uyku/mesai penceresi yok sayilir.';

CREATE TABLE IF NOT EXISTS seed_reply_queue (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id           uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seed_user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger_message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
  question_id        uuid,
  kind               text NOT NULL DEFAULT 'message'
                     CHECK (kind IN ('message', 'question', 'question_answer')),
  reply_due_at       timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'claimed', 'sent', 'failed', 'cancelled')),
  attempts           int NOT NULL DEFAULT 0,
  claimed_at         timestamptz,
  last_error         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Bir eslesmede ayni anda tek acik cevap: mukerrer cevabin birinci savunmasi.
CREATE UNIQUE INDEX IF NOT EXISTS idx_seed_reply_queue_open_match
  ON seed_reply_queue (match_id) WHERE status IN ('pending', 'claimed');

CREATE INDEX IF NOT EXISTS idx_seed_reply_queue_due
  ON seed_reply_queue (status, reply_due_at);

ALTER TABLE seed_reply_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON seed_reply_queue FROM anon, authenticated;

-- Atomik claim: deploy sirasinda iki instance ortusur, surec ici bayrak yetmez.
-- Emsal: chat_question_mark_power RPC'si (chat-question.service.ts:137).
CREATE OR REPLACE FUNCTION claim_seed_replies(p_limit int)
RETURNS SETOF seed_reply_queue
LANGUAGE sql
AS $$
  UPDATE seed_reply_queue q
     SET status = 'claimed', claimed_at = now(), attempts = q.attempts + 1, updated_at = now()
   WHERE q.id IN (
     SELECT id FROM seed_reply_queue
      WHERE status = 'pending' AND reply_due_at <= now()
      ORDER BY reply_due_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.*;
$$;

REVOKE ALL ON FUNCTION claim_seed_replies(int) FROM anon, authenticated;

COMMIT;
