-- 068_iap_reference_global_unique_rollback.sql
-- 068'i geri alir: IAP referansinin hesaplar arasi tekilligi kalkar. 047'nin kullanici basina
-- kisiti (uniq_diamond_money_reference) yerinde kalir. Kod degisikligi gerektirmez.
DROP INDEX IF EXISTS uniq_diamond_iap_reference_global;
