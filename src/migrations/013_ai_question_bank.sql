-- 013_ai_question_bank.sql
-- AI Question Bank: pre-built question suggestions replacing Gemini API

CREATE TABLE IF NOT EXISTS ai_question_bank (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  locale TEXT NOT NULL,
  category TEXT NOT NULL,
  question_text TEXT NOT NULL,
  answers JSONB NOT NULL,
  hint TEXT,
  target_gender TEXT,
  target_age_min INTEGER,
  target_age_max INTEGER,
  tone TEXT NOT NULL DEFAULT 'fun',
  shown_count INTEGER NOT NULL DEFAULT 0,
  selected_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_qbank_locale_question UNIQUE(locale, question_text),
  CONSTRAINT chk_qbank_tone CHECK (tone IN ('flirty', 'fun', 'deep')),
  CONSTRAINT chk_qbank_gender CHECK (target_gender IS NULL OR target_gender IN ('male', 'female')),
  CONSTRAINT chk_qbank_answers CHECK (jsonb_array_length(answers) = 4)
);

CREATE INDEX idx_qbank_locale_cat_active ON ai_question_bank(locale, category, is_active);
CREATE INDEX idx_qbank_locale_active ON ai_question_bank(locale, is_active);
CREATE INDEX idx_qbank_locale_qtext ON ai_question_bank(locale, question_text);

-- RPC for atomic counter increments
CREATE OR REPLACE FUNCTION increment_shown_count(question_ids UUID[])
RETURNS void AS $$
BEGIN
  UPDATE ai_question_bank
  SET shown_count = shown_count + 1
  WHERE id = ANY(question_ids);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_selected_count(p_locale TEXT, p_question_text TEXT)
RETURNS void AS $$
BEGIN
  UPDATE ai_question_bank
  SET selected_count = selected_count + 1
  WHERE locale = p_locale
    AND LOWER(TRIM(question_text)) = LOWER(TRIM(p_question_text))
    AND is_active = true;
END;
$$ LANGUAGE plpgsql;

-- Cleanup old Gemini cache table (guard against missing table)
DO $$ BEGIN
  TRUNCATE TABLE ai_question_suggestions;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
