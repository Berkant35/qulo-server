-- 019_chat_question_v2.sql
-- Chat Question System v2: 4-option support, timer, hints, reward media, power block, chat lock, drafts

-- ═══ chat_questions: new columns ═══
ALTER TABLE chat_questions
  ADD COLUMN IF NOT EXISTS option_count INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS option_c TEXT,
  ADD COLUMN IF NOT EXISTS option_d TEXT,
  ADD COLUMN IF NOT EXISTS time_limit_seconds INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS hint_text TEXT,
  ADD COLUMN IF NOT EXISTS reward_media_url TEXT,
  ADD COLUMN IF NOT EXISTS reward_media_type TEXT,
  ADD COLUMN IF NOT EXISTS has_chat_lock BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_power_block BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS power_block_removed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS powers_used JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS time_spent INTEGER;

-- Remove diamond_cost column default (questions are now free to create)
ALTER TABLE chat_questions ALTER COLUMN diamond_cost SET DEFAULT 0;

-- Update correct_option constraint to support C/D
ALTER TABLE chat_questions DROP CONSTRAINT IF EXISTS chat_questions_correct_option_check;
ALTER TABLE chat_questions ADD CONSTRAINT chat_questions_correct_option_check
  CHECK (correct_option IN ('A', 'B', 'C', 'D'));

-- Update answered_option constraint to support C/D
ALTER TABLE chat_questions DROP CONSTRAINT IF EXISTS chat_questions_answered_option_check;
ALTER TABLE chat_questions ADD CONSTRAINT chat_questions_answered_option_check
  CHECK (answered_option IN ('A', 'B', 'C', 'D'));

-- ═══ chat_question_drafts: new table ═══
CREATE TABLE IF NOT EXISTS chat_question_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  option_count INTEGER NOT NULL DEFAULT 2,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT,
  option_d TEXT,
  correct_option TEXT NOT NULL CHECK (correct_option IN ('A', 'B', 'C', 'D')),
  time_limit_seconds INTEGER NOT NULL DEFAULT 30,
  hint_text TEXT,
  has_unmatch_risk BOOLEAN DEFAULT false,
  has_chat_lock BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_question_drafts_user ON chat_question_drafts(user_id);

-- ═══ powers: add special_green_reward column + new power types ═══
ALTER TABLE powers ADD COLUMN IF NOT EXISTS special_green_reward INTEGER;

INSERT INTO powers (name, base_cost, green_cost, purple_cost, accuracy_rate, is_active, description, special_green_reward)
VALUES
  ('POWER_BLOCK', 40, 120, 40, NULL, true, 'Blocks opponent from using any powers during chat question', NULL),
  ('POWER_UNBLOCK', 50, 150, 50, NULL, true, 'Removes power block, enables power usage', 140)
ON CONFLICT (name) DO UPDATE SET
  base_cost = EXCLUDED.base_cost,
  green_cost = EXCLUDED.green_cost,
  purple_cost = EXCLUDED.purple_cost,
  description = EXCLUDED.description,
  special_green_reward = EXCLUDED.special_green_reward;
