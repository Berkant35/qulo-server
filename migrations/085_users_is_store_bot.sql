-- 085 · users.is_store_bot — mağaza test botlarını metriklerden ayıklama bayrağı.
--
-- Neden: Google Play her build yüklemesinde (internal track dahil) uygulamayı Firebase Test Lab
-- cihazlarında otomatik gezer; bu cihazlar gerçek gibi kayıt açar ("Test User", adsoyad.12345@gmail.com).
-- 2026-11-16'da 15 sahte kayıt geldi. Bayrak YALNIZ metrik içindir — uygulama davranışını değiştirmez
-- (is_test_account Rainbow'u açar + foto moderasyonunu atlar; bu yüzden ayrı kolon).
--
-- Kayıtta sunucu yazar (src/utils/store-bot.ts). Bu migration ADD COLUMN + geriye dönük işaretleme yapar:
--   1. Test Lab Google hesapları (@cloudtestlabaccounts.com)
--   2. Android + adsoyad.12345@gmail.com kalıbı (on-lansman cihaz hesapları)
--   3. Hiç üretime çıkmamış Android build'lerinden kayıt (rıza kaydındaki app_version):
--      93, 95, 99, 102, 103, 105, 106, 107 — 2026-11-17 canlı sorguyla 34 hesabın tamamı bot.
--
-- SIRA: bu migration sunucu deploy'undan ÖNCE uygulanır — kod insert'te kolonu yazar,
-- kolon yoksa kayıt patlar. Rollback: 085_users_is_store_bot_rollback.sql (önce kodu geri al).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_store_bot boolean NOT NULL DEFAULT false;

UPDATE public.users u
SET is_store_bot = true
WHERE u.is_store_bot = false
  AND (
    lower(u.email) LIKE '%@cloudtestlabaccounts.com'
    OR EXISTS (
      SELECT 1 FROM public.user_consents c
      WHERE c.user_id = u.id
        AND c.platform = 'android'
        AND (
          lower(u.email) ~ '^[a-z]+\.[0-9]{5}@gmail\.com$'
          OR c.app_version ~ '\+(93|95|99|102|103|105|106|107)$'
        )
    )
  );
