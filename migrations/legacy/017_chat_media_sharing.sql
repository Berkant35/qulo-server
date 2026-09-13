-- 017_chat_media_sharing.sql
-- Karşılıklı onay ile medya paylaşımı

ALTER TABLE matches ADD COLUMN media_enabled_by_user1 BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE matches ADD COLUMN media_enabled_by_user2 BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE media_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ
);

CREATE INDEX idx_media_requests_match ON media_requests(match_id, status);
