-- 031_anti_cheat_retention.sql
-- PII retention helpers for anti-cheat data.
-- Call via cron (Railway scheduled job or admin endpoint) — pg_cron not installed.

-- Anonymizes IP + location on quiz_sessions older than retention_days while preserving
-- timing metadata for analytics. Returns row count.
CREATE OR REPLACE FUNCTION anti_cheat_purge_quiz_session_pii(retention_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE quiz_sessions
     SET start_ip = NULL,
         start_location = NULL
   WHERE started_at < NOW() - (retention_days || ' days')::interval
     AND (start_ip IS NOT NULL OR start_location IS NOT NULL);

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- Hard-deletes anti_cheat_decisions rows older than retention_days.
-- Decision logs are operational telemetry; long-term value drops fast.
CREATE OR REPLACE FUNCTION anti_cheat_purge_decisions(retention_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  affected integer;
BEGIN
  DELETE FROM anti_cheat_decisions
   WHERE decided_at < NOW() - (retention_days || ' days')::interval;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
