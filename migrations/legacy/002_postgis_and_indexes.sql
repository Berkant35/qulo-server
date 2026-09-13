-- ============================================================
-- 002_postgis_and_indexes.sql
-- Qulo V2 - Indexes (spatial + performance)
-- ============================================================

-- Spatial index on user location (PostGIS geography)
CREATE INDEX idx_users_location
  ON users USING GIST ((ST_MakePoint(lng, lat)::geography))
  WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- Users indexes
CREATE INDEX idx_users_gender ON users (gender);
CREATE INDEX idx_users_age ON users (age);
CREATE INDEX idx_users_last_seen ON users (last_seen_at DESC);
CREATE INDEX idx_users_boost ON users (boost_until);
CREATE INDEX idx_users_email ON users (email);

-- Swipes indexes
CREATE INDEX idx_swipes_swiper ON swipes (swiper_id);
CREATE INDEX idx_swipes_target ON swipes (target_id);

-- Questions indexes
CREATE INDEX idx_questions_user ON questions (user_id);

-- Quiz sessions indexes
CREATE INDEX idx_quiz_sessions_solver ON quiz_sessions (solver_id);
CREATE INDEX idx_quiz_sessions_target ON quiz_sessions (target_id);
CREATE INDEX idx_quiz_sessions_status ON quiz_sessions (status)
  WHERE status = 'IN_PROGRESS';

-- Matches indexes (partial on active)
CREATE INDEX idx_matches_user1 ON matches (user1_id) WHERE is_active = true;
CREATE INDEX idx_matches_user2 ON matches (user2_id) WHERE is_active = true;

-- Messages indexes
CREATE INDEX idx_messages_match ON messages (match_id, created_at DESC);
CREATE INDEX idx_messages_unread ON messages (match_id) WHERE read_at IS NULL;

-- Diamond transactions indexes
CREATE INDEX idx_diamond_transactions_user ON diamond_transactions (user_id, created_at DESC);

-- Refresh tokens indexes
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens (token_hash);

-- Reports indexes (partial on pending)
CREATE INDEX idx_reports_reported ON reports (reported_id) WHERE status = 'PENDING';
