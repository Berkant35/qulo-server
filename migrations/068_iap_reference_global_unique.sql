-- 068_iap_reference_global_unique.sql
-- IAP satin alma referansi HESAPLAR ARASI tek (tek satin alma = tek kredi).
-- Spec: qulo/docs/superpowers/specs/2026-09-27-rainbow-market-design.md (final review F5)
--
-- Neden: 047'deki uniq_diamond_money_reference (user_id, reference_id) kullanici basina.
-- IAP referansi artik iki yolda da MAGAZA islem numarasi (istemci yolu RevenueCat API v1
-- non_subscriptions[].store_transaction_id, webhook transaction_id). Ayni magaza islemi iki
-- farkli hesaba (ayni RevenueCat musterisi / hesap degistirme) yazilabilirdi; odenmis mor ve
-- dolayisiyla rainbow (hediye karti) iki kez dogardi. Uygulama katmani (addPurple) 23505'i
-- `credited: 0` olarak doner — bu kisit son savunma.
--
-- Baseline (prod 2026-09-27): 3 IAP_PURCHASE satiri, hepsi farkli reference_id (tek kullanici,
-- 2026-08-01, o1_* RevenueCat id'leri). Kisit mevcut veriyle CAKISMAZ.
-- Geri alma: 068_iap_reference_global_unique_rollback.sql

BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_diamond_iap_reference_global
  ON diamond_transactions (reference_id)
  WHERE reason = 'IAP_PURCHASE' AND reference_id IS NOT NULL;
COMMIT;
