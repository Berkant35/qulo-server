-- 089 rollback — abonelik donemi kolonunu kaldir (haftalik paket geri alinirken).
-- DIKKAT: kolonu dusurmeden ONCE sunucu 2.2.0 oncesi surume donmus olmali; yeni sunucu kodu
-- `users.subscription_period` yazar, kolon yokken users guncellemeleri (plan dahil) hata verir.
-- Kolondaki veri kaybolur (haftalik aboneler aylik gorunur); bonus/odeme kayitlari etkilenmez.
BEGIN;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_subscription_period_check;
ALTER TABLE public.users DROP COLUMN IF EXISTS subscription_period;
COMMIT;
