-- ============================================
-- Migration 010: Question System Overhaul
-- ============================================

-- 1. questions tablosuna yeni kolonlar
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS time_limit INT NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS stats_copy_used INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_half_used INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_hint_used INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_time_extend_used INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_skip_used INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_total_time_spent INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_solve_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_green_earned INT NOT NULL DEFAULT 0;

-- time_limit constraint: 15, 30, 60, 90 saniye
ALTER TABLE questions
  ADD CONSTRAINT chk_time_limit CHECK (time_limit IN (15, 30, 60, 90));

-- 2. quiz_answers tablosuna time_spent kolonu
ALTER TABLE quiz_answers
  ADD COLUMN IF NOT EXISTS time_spent INT;

-- 3. question_pending_changes tablosu
CREATE TABLE IF NOT EXISTS question_pending_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL CHECK (change_type IN ('UPDATE', 'DELETE')),
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPLIED', 'CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ
);

ALTER TABLE question_pending_changes DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_pending_changes_user ON question_pending_changes(user_id, status);
CREATE INDEX idx_pending_changes_question ON question_pending_changes(question_id, status);

-- 4. ai_question_suggestions tablosu (cache)
CREATE TABLE IF NOT EXISTS ai_question_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  question_text TEXT NOT NULL,
  answers JSONB NOT NULL,
  correct_answer INT NOT NULL CHECK (correct_answer BETWEEN 1 AND 4),
  hint TEXT,
  locale TEXT NOT NULL DEFAULT 'tr',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ai_question_suggestions DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_ai_suggestions_category ON ai_question_suggestions(category, locale);

-- 5. quiz_sessions tablosuna quiz özeti alanları (chat kartı için)
ALTER TABLE quiz_sessions
  ADD COLUMN IF NOT EXISTS total_time_spent INT,
  ADD COLUMN IF NOT EXISTS powers_used JSONB DEFAULT '{}';

-- 6. stats_answer_distribution: hangi şık kaç kez seçildi
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS stats_answer_1_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_answer_2_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_answer_3_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_answer_4_count INT NOT NULL DEFAULT 0;
