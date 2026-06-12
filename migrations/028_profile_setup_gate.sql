-- 028_profile_setup_gate.sql
-- Profile Setup Gate: interests + question_count cache + indexes

BEGIN;

-- Yeni kolonlar
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS interests TEXT[] DEFAULT '{}' NOT NULL,
  ADD COLUMN IF NOT EXISTS question_count INT DEFAULT 0 NOT NULL;

-- Backfill mevcut user'lar
UPDATE users u
SET question_count = COALESCE(
  (SELECT COUNT(*)::INT FROM questions q WHERE q.user_id = u.id),
  0
);

-- Indexler
CREATE INDEX IF NOT EXISTS idx_users_interests ON users USING GIN (interests);
CREATE INDEX IF NOT EXISTS idx_users_question_count ON users(question_count);

COMMIT;
