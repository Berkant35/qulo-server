-- 029_questions_order_unique.sql
-- Add unique constraint so concurrent inserts surface as 23505 instead of silently duplicating.
-- Closes the race in quickAssignQuestions (T8 review).

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_questions_user_order
  ON questions(user_id, order_num);

COMMIT;
