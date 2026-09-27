-- 069_reward_redemptions_keep_on_purge.sql
-- Rainbow market Plan 2 (docs/superpowers/plans/2026-09-27-rainbow-market-2-market-backoffice.md).
--
-- 1) Hediye kartı talebi finansal kayıttır (tedarikçiye ödenmiş bir kart). Hesap kalıcı silinince
--    (account-purge.service hardDeleteUser → users DELETE) talep satırı SİLİNMEZ; kullanıcı bağı NULL olur.
--    067'de FK ON DELETE CASCADE idi. RESTRICT seçilmedi: purge'ü (yeniden kayıt akışı) kırardı.
-- 2) İade sinyali, iade edenin ödenmiş harcamasından rainbow kazananları defter referansıyla bulur
--    (rainbow-risk.service): RAINBOW satırlarında reference_id araması için kısmi indeks.
--
-- Kilit kapsamı: işlem içindeki kilitler COMMIT'e kadar tutulur. FK'yı düşürmek/eklemek `users`
-- üzerinde de kilit alır (DROP: ACCESS EXCLUSIVE) — bu kilit indeks inşası boyunca tutulursa
-- `users` okumaları dahil tüm API bekler. Bu yüzden İNDEKS ÖNCE (yalnız diamond_transactions
-- yazımlarını bekletir), FK adımları EN SONDA: `users` kilidi milisaniyeler sürer.
-- `lock_timeout`: kilit 3 sn'de alınamazsa migration düşer (kuyrukta bekleyip trafiği kilitlemez) —
-- tekrar çalıştırmak güvenli (IF EXISTS / IF NOT EXISTS).
--
-- Additive / gevşetici: mevcut satırlar değişmez. RLS/GRANT'e dokunmaz.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE INDEX IF NOT EXISTS idx_diamond_rainbow_reference
  ON diamond_transactions (reference_id)
  WHERE type = 'RAINBOW' AND reference_id IS NOT NULL;

ALTER TABLE reward_redemptions ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE reward_redemptions DROP CONSTRAINT IF EXISTS reward_redemptions_user_id_fkey;
ALTER TABLE reward_redemptions
  ADD CONSTRAINT reward_redemptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

COMMIT;
