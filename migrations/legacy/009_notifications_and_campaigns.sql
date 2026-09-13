-- ============================================================
-- 009_notifications_and_campaigns.sql
-- Qulo V2 - Notifications, Campaigns & Campaign Analytics
-- ============================================================

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id UUID, -- FK added after campaigns table
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  image_url TEXT,
  action_url TEXT,
  action_label TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_user_read ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- CAMPAIGNS
-- ============================================================

CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  push_title TEXT NOT NULL,
  push_body TEXT NOT NULL,
  image_url TEXT,
  action_url TEXT,
  action_label TEXT,
  segment JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES admin_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- FK: notifications.campaign_id → campaigns
-- ============================================================

ALTER TABLE notifications
  ADD CONSTRAINT fk_notifications_campaign
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;

-- ============================================================
-- CAMPAIGN STATS
-- ============================================================

CREATE TABLE campaign_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL UNIQUE REFERENCES campaigns(id) ON DELETE CASCADE,
  total_targeted INTEGER NOT NULL DEFAULT 0,
  total_sent INTEGER NOT NULL DEFAULT 0,
  total_delivered INTEGER NOT NULL DEFAULT 0,
  total_opened INTEGER NOT NULL DEFAULT 0,
  total_clicked INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE campaign_stats ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- CAMPAIGN EVENTS
-- ============================================================

CREATE TABLE campaign_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (event IN ('sent', 'delivered', 'opened', 'clicked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaign_events_campaign_id ON campaign_events(campaign_id);
CREATE INDEX idx_campaign_events_user_id ON campaign_events(user_id);

ALTER TABLE campaign_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RPC: increment_campaign_stat
-- Atomically increments a stat field by 1
-- ============================================================

CREATE OR REPLACE FUNCTION increment_campaign_stat(p_campaign_id UUID, p_field TEXT)
RETURNS VOID AS $$
BEGIN
  EXECUTE format(
    'UPDATE campaign_stats SET %I = %I + 1 WHERE campaign_id = $1',
    p_field, p_field
  ) USING p_campaign_id;
END;
$$ LANGUAGE plpgsql;
