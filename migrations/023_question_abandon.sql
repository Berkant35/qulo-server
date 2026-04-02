-- 023_question_abandon.sql
-- Adds is_abandoned flag for question abandon feature

ALTER TABLE chat_questions
  ADD COLUMN IF NOT EXISTS is_abandoned BOOLEAN DEFAULT FALSE;

-- Allow answered_option to be NULL when abandoned (constraint already allows NULL in PostgreSQL CHECK)
-- No constraint change needed - CHECK (answered_option IN ('A','B','C','D')) already passes for NULL values

COMMENT ON COLUMN chat_questions.is_abandoned IS 'True when receiver left the question without answering';
