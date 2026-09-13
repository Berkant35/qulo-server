-- Migration 015: Add total_questions column to quiz_sessions
-- Fixes POST /quiz/start 500 error — quiz.service.ts inserts total_questions but column was missing

ALTER TABLE quiz_sessions
  ADD COLUMN total_questions INT NOT NULL DEFAULT 0;
