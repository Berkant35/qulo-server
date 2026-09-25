-- 063: Tekrarlayan (gunluk, rastgele saatli) kampanyalar (2026-09-25)
-- Kampanya artik 'none' (tek seferlik, mevcut) veya 'daily' olabilir. Daily kampanya status='scheduled'
-- oldugu surece her gun, kullanicinin yerel saatine gore [window_start_hour, window_end_hour) icinde
-- kampanya+gun hash'inden secilen rastgele dakikada gider; 'paused' ile durdurulur.
-- recurrence_days: ISO haftanin gunleri (1=Pzt..7=Paz); NULL/bos = her gun.
-- variants: [{title, body}] — gunluk rotasyon (ayni metin her gun gitmesin); bos ise push_title/push_body.
ALTER TABLE campaigns
  ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'daily')),
  ADD COLUMN recurrence_days SMALLINT[],
  ADD COLUMN window_start_hour SMALLINT CHECK (window_start_hour BETWEEN 0 AND 23),
  ADD COLUMN window_end_hour SMALLINT CHECK (window_end_hour BETWEEN 1 AND 24),
  ADD COLUMN variants JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE campaigns DROP CONSTRAINT campaigns_status_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled', 'paused'));

-- Ayni kampanya + kullanici + yerel gun icin tek gonderim: kayit FCM'den ONCE atilir (claim),
-- iki sunucu instance'i ayni tikte calissa da unique index ikinciyi durdurur.
ALTER TABLE campaign_events ADD COLUMN dedupe_key TEXT;
CREATE UNIQUE INDEX campaign_events_dedupe_key_key ON campaign_events (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_campaign_events_campaign_created ON campaign_events (campaign_id, created_at DESC);
