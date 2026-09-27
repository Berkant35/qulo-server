-- 067_rainbow_market.sql
-- Rainbow elmas + hediye karti marketi.
-- Spec: qulo/docs/superpowers/specs/2026-09-27-rainbow-market-design.md
--
-- Neden: bedava dagitilan mor elmas (milestone, rozet, referral, abonelik bonusu, donusum)
-- hediye kartina, yani gercek paraya donusmesin. Morun odenmis kismi gizli bir sayacta
-- tutulur; yalniz o kisim harcaninca karsi tarafta RAINBOW dogar.
--
-- Baseline (2026-09-27, prod): diamond_type = {GREEN, PURPLE}; users'ta purple_paid,
-- rainbow_diamonds, rainbow_flagged_at yok; diamond_transactions.paid_amount yok;
-- reward_* tablolari yok. purple_diamonds'i yazan kod yalniz diamond.service.ts ve
-- admin.service.ts (grep 2026-09-27) — purple_paid <= purple_diamonds kisiti bu ikisiyle uyumlu.

-- 1) Enum degeri. Transaction icinde eklenen enum degeri ayni transaction'da kullanilamaz;
--    024_gender_other emsali: BEGIN disinda.
ALTER TYPE diamond_type ADD VALUE IF NOT EXISTS 'RAINBOW';

BEGIN;

-- 2) Kullanici sayaclari. purple_paid gizli: morun parayla alinmis kismi.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS purple_paid INTEGER NOT NULL DEFAULT 0 CHECK (purple_paid >= 0),
  ADD COLUMN IF NOT EXISTS rainbow_diamonds INTEGER NOT NULL DEFAULT 0 CHECK (rainbow_diamonds >= 0),
  ADD COLUMN IF NOT EXISTS rainbow_flagged_at TIMESTAMPTZ NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_purple_paid_le_purple') THEN
    ALTER TABLE users ADD CONSTRAINT users_purple_paid_le_purple CHECK (purple_paid <= purple_diamonds);
  END IF;
END $$;

-- 3) Defter: PURPLE satirlarinda odenmis pay (denetim + iade sinyali).
ALTER TABLE diamond_transactions
  ADD COLUMN IF NOT EXISTS paid_amount INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0);

-- 4) Market ulkeleri — varsayilan KAPALI. iOS ayri anahtar (Apple inceleme riski ayri karar).
CREATE TABLE IF NOT EXISTS reward_market_countries (
  country_code TEXT PRIMARY KEY CHECK (country_code ~ '^[A-Z]{2}$'),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  enabled BOOLEAN NOT NULL DEFAULT false,
  android_enabled BOOLEAN NOT NULL DEFAULT true,
  ios_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO reward_market_countries (country_code, currency) VALUES
  ('TH', 'THB'), ('ID', 'IDR'), ('MY', 'MYR')
ON CONFLICT (country_code) DO NOTHING;

-- 5) Katalog. rainbow_price backoffice'ten ayarlanir; cost_usd admin'in odedigi (oneri icin).
CREATE TABLE IF NOT EXISTS reward_catalog_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_key TEXT NOT NULL CHECK (brand_key IN
    ('GRAB','GOPAY','DANA','OVO','SHOPEEPAY','TRUEMONEY','LINEMAN','TNG','FOODPANDA','OTHER')),
  country_code TEXT NOT NULL REFERENCES reward_market_countries(country_code),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  face_value NUMERIC(12,2) NOT NULL CHECK (face_value > 0),
  cost_usd NUMERIC(10,2) NULL CHECK (cost_usd IS NULL OR cost_usd > 0),
  rainbow_price INTEGER NOT NULL CHECK (rainbow_price > 0),
  is_active BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  logo_url TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_reward_catalog_country
  ON reward_catalog_items (country_code, is_active, sort_order)
  WHERE deleted_at IS NULL;

-- 6) Itfa talepleri — onay kuyrugu. Urun alanlari anlik goruntu (fiyat sonradan degisse de).
CREATE TABLE IF NOT EXISTS reward_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES reward_catalog_items(id),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','FULFILLED','REJECTED')),
  rainbow_price INTEGER NOT NULL CHECK (rainbow_price > 0),
  brand_key TEXT NOT NULL,
  country_code TEXT NOT NULL,
  currency TEXT NOT NULL,
  face_value NUMERIC(12,2) NOT NULL,
  delivery_code TEXT NULL,
  delivery_url TEXT NULL,
  admin_note TEXT NULL,
  reject_reason TEXT NULL,
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 100),
  platform TEXT NULL CHECK (platform IS NULL OR platform IN ('ios','android')),
  is_test BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ NULL,
  decided_by UUID NULL REFERENCES admin_users(id),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_reward_redemptions_status ON reward_redemptions (status, created_at);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_user ON reward_redemptions (user_id, created_at DESC);

-- 7) Erisim: yalniz service_role (064/059 kalibi). Politika yok.
ALTER TABLE reward_market_countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON reward_market_countries FROM anon, authenticated;
REVOKE ALL ON reward_catalog_items FROM anon, authenticated;
REVOKE ALL ON reward_redemptions FROM anon, authenticated;

-- 8) Baslangic katalogu — PASIF. Fiyat = ceil(cost_usd / 0.03); cost_usd = itibari deger
--    (kur 2026-09-13) x (1 + Tremendous ucreti: hediye karti %0, cuzdan %5).
--    Yalniz katalog bossa eklenir — migration tekrar calistirilirsa cift satir olusmaz.
INSERT INTO reward_catalog_items (brand_key, country_code, currency, face_value, cost_usd, rainbow_price, sort_order)
SELECT v.brand_key, v.country_code, v.currency, v.face_value, v.cost_usd, v.rainbow_price, v.sort_order
FROM (VALUES
  ('GRAB',      'ID', 'IDR', 25000::numeric, 1.42::numeric,  48, 10),
  ('DANA',      'ID', 'IDR', 10000::numeric, 0.60::numeric,  20, 20),
  ('SHOPEEPAY', 'ID', 'IDR', 10000::numeric, 0.60::numeric,  20, 30),
  ('GRAB',      'TH', 'THB',    50::numeric, 1.51::numeric,  51, 10),
  ('TRUEMONEY', 'TH', 'THB',    20::numeric, 0.64::numeric,  22, 20),
  ('LINEMAN',   'TH', 'THB',   100::numeric, 3.03::numeric, 101, 30),
  ('GRAB',      'MY', 'MYR',     5::numeric, 1.23::numeric,  41, 10),
  ('TNG',       'MY', 'MYR',    10::numeric, 2.46::numeric,  82, 20),
  ('FOODPANDA', 'MY', 'MYR',    10::numeric, 2.46::numeric,  82, 30)
) AS v(brand_key, country_code, currency, face_value, cost_usd, rainbow_price, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM reward_catalog_items);

COMMIT;
