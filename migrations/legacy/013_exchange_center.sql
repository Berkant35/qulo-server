-- 013_exchange_center.sql
-- Exchange Center: power inventory, COPY→ORACLE, green→purple conversion

-- 1. user_power_inventory tablosu
CREATE TABLE user_power_inventory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  power_name TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, power_name)
);

CREATE INDEX idx_user_power_inventory_user ON user_power_inventory(user_id);

-- 2. power_purchase_transactions tablosu
CREATE TABLE power_purchase_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  power_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  diamond_type diamond_type NOT NULL,
  total_cost INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_power_purchase_tx_user ON power_purchase_transactions(user_id);

-- 3. powers tablosuna yeni kolonlar
ALTER TABLE powers ADD COLUMN green_cost INTEGER NOT NULL DEFAULT 0;
ALTER TABLE powers ADD COLUMN purple_cost INTEGER NOT NULL DEFAULT 0;
ALTER TABLE powers ADD COLUMN accuracy_rate DECIMAL DEFAULT NULL;

-- 4. COPY → ORACLE dönüşümü
UPDATE powers SET name = 'ORACLE', base_cost = 5, accuracy_rate = 0.70,
  description = 'Oracle suggests an answer with 70% accuracy'
  WHERE name = 'COPY';

-- 5. green_cost ve purple_cost varsayılan değerleri (base_cost ile aynı, yeşil 3x)
UPDATE powers SET purple_cost = base_cost, green_cost = base_cost * 3;
