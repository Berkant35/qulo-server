-- 088 rollback — ödüllü reklam talep tablosunu kaldır (verilmiş mor bakiyeleri DEĞİŞMEZ).
BEGIN;
DROP TABLE IF EXISTS public.rewarded_ad_claims;
COMMIT;
