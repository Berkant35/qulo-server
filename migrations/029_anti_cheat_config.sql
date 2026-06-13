-- 029_anti_cheat_config.sql
-- Singleton config row for anti-cheat behavior + decision audit log.
-- Default: all rules OFF. Admin enables via /admin/anti-cheat-config form.

CREATE TABLE IF NOT EXISTS anti_cheat_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  updated_by uuid REFERENCES admin_users(id) ON DELETE SET NULL
);

INSERT INTO anti_cheat_config (id, config) VALUES (1, '{
  "proximity_exclusion": {
    "enabled": false,
    "dry_run": false,
    "rollout_pct": 0,
    "radius_meters": 50,
    "ttl_hours": 24,
    "ip_match_also": true,
    "require_location": true
  },
  "drip_questions": {
    "enabled": false,
    "dry_run": false
  },
  "min_think_time": {
    "enabled": false,
    "dry_run": false,
    "min_seconds": 2.0
  },
  "viewer_specific_shuffle": {
    "enabled": false,
    "dry_run": false
  }
}'::jsonb)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS anti_cheat_decisions (
  id bigserial PRIMARY KEY,
  decided_at timestamptz NOT NULL DEFAULT NOW(),
  rule text NOT NULL,
  viewer_id uuid,
  target_id uuid,
  session_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('BLOCKED', 'DRY_RUN_BLOCKED', 'ALLOWED', 'ERRORED')),
  reason jsonb
);

CREATE INDEX IF NOT EXISTS anti_cheat_decisions_decided_idx
  ON anti_cheat_decisions (decided_at DESC, rule);

CREATE INDEX IF NOT EXISTS anti_cheat_decisions_viewer_idx
  ON anti_cheat_decisions (viewer_id, decided_at DESC)
  WHERE viewer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS anti_cheat_decisions_target_idx
  ON anti_cheat_decisions (target_id, decided_at DESC)
  WHERE target_id IS NOT NULL;
