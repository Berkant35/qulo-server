-- 028_anti_cheat_quiz_sessions_geo.sql
-- Adds proximity + IP capture and per-question serve timestamp to quiz_sessions.
-- These columns power L1 discover-layer exclusion and L2 min think-time enforcement.

ALTER TABLE quiz_sessions
  ADD COLUMN IF NOT EXISTS start_location geography(POINT, 4326),
  ADD COLUMN IF NOT EXISTS start_ip text,
  ADD COLUMN IF NOT EXISTS last_q_served_at timestamptz;

-- GIST index for proximity lookup. Predicate-based partial index not used because
-- NOW() is not IMMUTABLE; querying with started_at filter still uses this index
-- + the target_id filter combined with seqscan for time filter is fast at our scale.
CREATE INDEX IF NOT EXISTS quiz_sessions_start_location_geog_idx
  ON quiz_sessions USING GIST (start_location)
  WHERE start_location IS NOT NULL;

-- Partial B-tree for IP match path; only rows with captured IP.
CREATE INDEX IF NOT EXISTS quiz_sessions_target_ip_idx
  ON quiz_sessions (target_id, start_ip, started_at DESC)
  WHERE start_ip IS NOT NULL;
