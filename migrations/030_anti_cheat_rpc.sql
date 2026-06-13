-- 030_anti_cheat_rpc.sql
-- RPC for proximity hit check used by L1 discover exclusion.
-- Returns at most one matching solver+distance pair (any hit triggers block).

CREATE OR REPLACE FUNCTION anti_cheat_proximity_hit(
  p_target_id uuid,
  p_viewer_id uuid,
  p_lng double precision,
  p_lat double precision,
  p_radius_m integer,
  p_cutoff timestamptz
)
RETURNS TABLE (solver_id uuid, distance_m double precision)
LANGUAGE sql
STABLE
AS $$
  SELECT
    qs.solver_id,
    ST_Distance(qs.start_location, ST_MakePoint(p_lng, p_lat)::geography) AS distance_m
  FROM quiz_sessions qs
  WHERE qs.target_id = p_target_id
    AND qs.solver_id <> p_viewer_id
    AND qs.start_location IS NOT NULL
    AND qs.started_at >= p_cutoff
    AND ST_DWithin(
      qs.start_location,
      ST_MakePoint(p_lng, p_lat)::geography,
      p_radius_m
    )
  ORDER BY qs.started_at DESC
  LIMIT 1;
$$;
