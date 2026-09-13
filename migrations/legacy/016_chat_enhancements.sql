-- 016_chat_enhancements.sql
-- Chat sistemi yeni özellikler: sorular, reactions, silme, ses mesajı

-- Chat içi sorular
CREATE TABLE chat_questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id),
  question_text TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  correct_option CHAR(1) NOT NULL CHECK (correct_option IN ('A', 'B')),
  has_unmatch_risk BOOLEAN NOT NULL DEFAULT false,
  diamond_cost INT NOT NULL DEFAULT 5,
  answered_option CHAR(1) CHECK (answered_option IN ('A', 'B')),
  is_correct BOOLEAN,
  answered_at TIMESTAMPTZ,
  question_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Message reactions
CREATE TABLE message_reactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(message_id, user_id, emoji)
);

-- Messages tablosuna soft delete + ses mesajı
ALTER TABLE messages ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN audio_url TEXT;
ALTER TABLE messages ADD COLUMN audio_duration_seconds INT;

-- Indexes
CREATE INDEX idx_chat_questions_match ON chat_questions(match_id);
CREATE INDEX idx_chat_questions_sender_date ON chat_questions(sender_id, match_id, question_date);
CREATE INDEX idx_message_reactions_message ON message_reactions(message_id);
CREATE INDEX idx_messages_not_deleted ON messages(match_id, created_at) WHERE deleted_at IS NULL;
