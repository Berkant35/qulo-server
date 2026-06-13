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

-- Trigger: questions insert/delete → users.question_count cache sync
CREATE OR REPLACE FUNCTION sync_user_question_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE users SET question_count = question_count + 1 WHERE id = NEW.user_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE users SET question_count = GREATEST(question_count - 1, 0) WHERE id = OLD.user_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_user_question_count ON questions;
CREATE TRIGGER trg_sync_user_question_count
  AFTER INSERT OR DELETE ON questions
  FOR EACH ROW EXECUTE FUNCTION sync_user_question_count();

COMMIT;
