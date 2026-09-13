-- 008_subscriptions_and_iap_update.sql
-- Subscription takibi
CREATE TABLE user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('plus', 'premium')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  rc_customer_id TEXT,
  store_transaction_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_subscriptions_user ON user_subscriptions(user_id, status);
CREATE INDEX idx_user_subscriptions_expires ON user_subscriptions(expires_at) WHERE status = 'active';

-- IAP transaction logları
CREATE TABLE iap_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  store TEXT NOT NULL CHECK (store IN ('apple', 'google')),
  transaction_id TEXT UNIQUE,
  rc_event_type TEXT,
  amount_usd DECIMAL(10,2),
  purple_credited INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_iap_transactions_user ON iap_transactions(user_id, created_at DESC);

-- Users tablosuna subscription alanları ekle
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rc_customer_id TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_swipes_used INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_swipes_reset_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_undos_used INT NOT NULL DEFAULT 0;

-- RLS disable (service_role kullanıyoruz)
ALTER TABLE user_subscriptions DISABLE ROW LEVEL SECURITY;
ALTER TABLE iap_transactions DISABLE ROW LEVEL SECURITY;

-- iap_products tablosunu güncelle (yeni tier'lar)
DELETE FROM iap_products;
INSERT INTO iap_products (store_id_ios, store_id_android, purple_amount, tier, is_active) VALUES
  ('qulopurple50', 'qulopurple50', 50, 1, true),
  ('qulopurple150', 'qulopurple150', 150, 2, true),
  ('qulopurple400', 'qulopurple400', 400, 3, true),
  ('qulopurple1000', 'qulopurple1000', 1000, 4, true),
  ('qulopurple2500', 'qulopurple2500', 2500, 5, true),
  ('qulopurple6000', 'qulopurple6000', 6000, 6, true);
