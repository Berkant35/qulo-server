-- 046 rollback
DROP INDEX IF EXISTS idx_push_log_created;
CREATE INDEX IF NOT EXISTS idx_push_log_rule_created ON push_log (rule_key, created_at DESC);
