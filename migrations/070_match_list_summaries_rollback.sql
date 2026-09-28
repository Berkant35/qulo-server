-- 070_match_list_summaries_rollback.sql
-- ONCE KODU GERI AL: matching.service.ts `getMatches` bu RPC'yi cagiriyor. Kod geri alinmadan
-- fonksiyon dusurulurse eslesme listesi (GET /matches) calismaya devam eder ama son mesaj
-- onizlemesi ve okunmamis sayilari bos gelir (hata Railway loglarina `[matching] match_list_summaries`
-- olarak duser).

BEGIN;

DROP FUNCTION IF EXISTS match_list_summaries(uuid, uuid[]);

COMMIT;
