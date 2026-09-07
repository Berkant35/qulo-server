-- 047 — Para yollarinda cift kredi icin DB seviyesinde tekillik kisiti
--
-- GEREKCE (2026-09-05 canli olayi): tek Plus satin almasinda kullaniciya 500
-- yerine 1000 mor elmas yatti. Uygulama katmanindaki koruma "once oku, sonra
-- yaz" (diamond.service.ts addPurple) — iki istek 0.5 sn arayla geldi ve
-- guard'i asti. Uygulama katmani bu yarisi kapatamaz; kisit DB'de olmali.
--
-- KAPSAM sadece PARANIN oldugu iki sebep:
--   SUBSCRIPTION_BONUS — abonelik aylik bonusu
--   IAP_PURCHASE       — elmas paketi satin almasi
--
-- POWER_USED / POWER_REWARD KAPSAM DISI: reference_id oturum bazli oldugu icin
-- ayni oturumda birden fazla guc kullanimi MESRU ve mevcut veride var
-- (2026-09-04: ORACLE 3, HALF 2, SKIP 1 mukerrer anahtar). Kisit konursa
-- gercek kullanim kirilir.
--
-- PROFILE_COMPLETION da KAPSAM DISI: 13 mukerrer anahtar var (Haziran 2026,
-- 14 fazla satir / 135 elmas). Bu da bir hata ama once veri temizligi gerekir;
-- ayri bir migration'a birakildi.
--
-- BASELINE (uygulamadan once olculdu):
--   SUBSCRIPTION_BONUS  3 anahtar, 0 mukerrer
--   IAP_PURCHASE        3 anahtar, 0 mukerrer
-- Yani bu kisit mevcut veriyle CAKISMAZ.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_diamond_money_reference
  ON public.diamond_transactions (user_id, reference_id)
  WHERE reference_id IS NOT NULL
    AND reason IN ('SUBSCRIPTION_BONUS', 'IAP_PURCHASE');

COMMENT ON INDEX public.uniq_diamond_money_reference IS
  'Cift kredi koruması: abonelik bonusu ve IAP satin almasi kullanici+referans basina tek satir. Uygulama katmanindaki read-then-write guard yarisa acik oldugu icin son savunma burasi.';
