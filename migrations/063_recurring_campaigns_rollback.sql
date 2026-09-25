-- 063 rollback: tekrarlayan kampanya kolonlari ve dedupe indeksi kaldirilir.
-- Once daily kampanyalar iptal edilir ki status check'i daraltirken satir takilmasin.
UPDATE campaigns SET status = 'cancelled' WHERE status = 'paused';
DROP INDEX IF EXISTS idx_campaign_events_campaign_created;
DROP INDEX IF EXISTS campaign_events_dedupe_key_key;
ALTER TABLE campaign_events DROP COLUMN IF EXISTS dedupe_key;
ALTER TABLE campaigns DROP CONSTRAINT campaigns_status_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled'));
ALTER TABLE campaigns
  DROP COLUMN IF EXISTS recurrence,
  DROP COLUMN IF EXISTS recurrence_days,
  DROP COLUMN IF EXISTS window_start_hour,
  DROP COLUMN IF EXISTS window_end_hour,
  DROP COLUMN IF EXISTS variants;
