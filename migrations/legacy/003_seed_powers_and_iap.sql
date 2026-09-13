-- ============================================================
-- 003_seed_powers_and_iap.sql
-- Qulo V2 - Seed data for powers and IAP products
-- ============================================================

-- Powers (name, base_cost in green diamonds, description)
INSERT INTO powers (name, base_cost, description) VALUES
  ('COPY',        15, 'Copy the correct answer from a question'),
  ('HALF',        10, 'Eliminate two wrong answers'),
  ('SKIP',        20, 'Skip the current question'),
  ('SKIP_ALL',    60, 'Skip all remaining questions in the quiz'),
  ('TIME_EXTEND',  5, 'Extend quiz session time'),
  ('HINT',         8, 'Show a hint for the current question');

-- IAP Products (purple diamond packages)
INSERT INTO iap_products (store_id_android, store_id_ios, purple_amount, tier) VALUES
  ('qulo_purple_30',   'qulo_purple_30',   30,   1),
  ('qulo_purple_80',   'qulo_purple_80',   80,   2),
  ('qulo_purple_180',  'qulo_purple_180',  180,  3),
  ('qulo_purple_400',  'qulo_purple_400',  400,  4),
  ('qulo_purple_900',  'qulo_purple_900',  900,  5),
  ('qulo_purple_2000', 'qulo_purple_2000', 2000, 6);
