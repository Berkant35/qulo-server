-- 073 · public.users.is_test_admin DEFAULT drift'ini düzelt.
--
-- Hikaye: legacy/019_test_account_flag.sql sütunu `DEFAULT false` ile açtı ama prod DB'de
-- default `true` olarak drift etmişti (kim ne zaman değiştirdi bilinmiyor; muhtemel elle
-- ALTER TABLE ... SET DEFAULT true dönemi). Bu drift Haziran 2026'dan beri her yeni
-- Apple/Google sosyal kaydında (auth.service.ts Case C insert `is_test_admin` alanını
-- set etmiyor → DB default devreye giriyor) `is_test_admin=true` yazılmasına sebep oldu.
-- 29 Eylül tespitinde 194 total test_admin, 48'i Apple relay çıktı; PM acil temizlik yaptı.
--
-- Bu migration DB seviyesinde default'u tekrar `false` yapar. Kod tarafında ayrıca
-- auth.service.ts insert'lerine açık `is_test_admin: false` savunması eklenir — DB
-- default'una bir daha güvenmeyelim.

ALTER TABLE public.users
  ALTER COLUMN is_test_admin SET DEFAULT false;
