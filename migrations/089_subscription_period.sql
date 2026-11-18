-- 089_subscription_period.sql
-- Qulo 2.2.0 B4 (haftalik Plus paketi, karar K1): abonelik DONEMI plandan ayri alan.
--   users.subscription_period: 'weekly' | 'monthly' | NULL
-- NULL = donem kaydi yok: plan varsa 'monthly' sayilir (haftalik paketten onceki tum abonelikler aylik),
-- plan yoksa anlamsiz. Mevcut satirlar DEGISMEZ (backfill gerekmez, ucuz ADD COLUMN).
--
-- !! UYGULAMA SIRASI: bu migration, haftalik paket sunucu kodu (release/2.2.0) yayinlanmadan ONCE
-- uygulanir. Yeni kod `users` guncellemelerine subscription_period yazar; kolon yoksa PostgREST tum
-- guncellemeyi reddeder (plan/sure dahil) ve odeme alinip hak verilmez. Kolon ekleme eski kodu bozmaz.
-- Rollback: 089_subscription_period_rollback.sql.
BEGIN;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS subscription_period text;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_subscription_period_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_subscription_period_check
  CHECK (subscription_period IS NULL OR subscription_period IN ('weekly', 'monthly'));

COMMENT ON COLUMN public.users.subscription_period IS
  'Aktif aboneligin faturalama donemi (weekly|monthly). NULL + plan = monthly (eski abonelikler).';

COMMIT;
