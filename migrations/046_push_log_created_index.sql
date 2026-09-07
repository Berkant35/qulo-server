-- 046_push_log_created_index.sql
-- Motorun push_log sorgularinin hepsi created_at ile filtreler (son 20 saat / lookback / 7 gunluk istatistik /
-- 90 gun temizlik). 045'teki (rule_key, created_at) indeksini hicbir sorgu kullanmiyor → yerine created_at.

CREATE INDEX IF NOT EXISTS idx_push_log_created ON push_log (created_at DESC);
DROP INDEX IF EXISTS idx_push_log_rule_created;
