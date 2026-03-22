-- Add question_ids column to quiz_sessions
-- Stores the filtered+ordered question IDs at session creation time
-- This prevents race conditions when questions change during a quiz
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS question_ids JSONB DEFAULT NULL;
