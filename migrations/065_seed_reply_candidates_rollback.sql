-- 065_seed_reply_candidates_rollback.sql
-- ONCE KODU GERI AL: seed-reply.service.ts `scanAndEnqueue` bu RPC'yi cagiriyor ve hatayi
-- bilerek firlatiyor (sessiz "aday yok" yok). Kod geri alinmadan fonksiyon dusurulurse her
-- seed-reply tiki hata verir ve botlar tamamen susar.

BEGIN;

DROP FUNCTION IF EXISTS seed_reply_candidates(int);

COMMIT;
