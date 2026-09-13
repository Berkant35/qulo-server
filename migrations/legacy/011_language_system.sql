-- Migration 011: Language System
-- Adds user_languages table for multi-language preferences
-- Adds locale column to questions table
-- Expands users.locale constraint to support more languages

-- 1. Supported locales list (used in constraints)
-- tr, en, de, fr, es, ar, ru, pt, it, ja, ko, zh, nl, pl, sv

-- 2. User languages table (many-to-many)
CREATE TABLE IF NOT EXISTS user_languages (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL CHECK (language_code IN ('tr','en','de','fr','es','ar','ru','pt','it','ja','ko','zh','nl','pl','sv')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, language_code)
);

-- Index for fast lookup by user
CREATE INDEX idx_user_languages_user ON user_languages(user_id);

-- 3. Add locale column to questions table
ALTER TABLE questions ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'tr'
  CHECK (locale IN ('tr','en','de','fr','es','ar','ru','pt','it','ja','ko','zh','nl','pl','sv'));

-- Index for filtering questions by locale
CREATE INDEX idx_questions_locale ON questions(user_id, locale);

-- 4. Expand users.locale constraint to support all languages
-- Drop old constraint and add new one
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_locale_check;
ALTER TABLE users ADD CONSTRAINT users_locale_check
  CHECK (locale IN ('tr','en','de','fr','es','ar','ru','pt','it','ja','ko','zh','nl','pl','sv'));

-- 5. Backfill: Insert current user locale into user_languages for all existing users
INSERT INTO user_languages (user_id, language_code)
SELECT id, locale FROM users
ON CONFLICT (user_id, language_code) DO NOTHING;
