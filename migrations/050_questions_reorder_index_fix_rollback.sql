-- 050 rollback — 029'un deferrable olmayan index'ini geri koyar.
--
-- DIKKAT: bu, soru siralamayi yeniden KIRAR (her gercek siralama unique_violation
-- ile basarisiz olur). Yalnizca 050 beklenmedik bir regresyon uretirse kullan.
-- Deferrable kisit (questions_user_id_order_num_key) 050'den ONCE de prod'daydi;
-- geri almada ona dokunulmuyor. Veri zaten unique oldugu icin index yeniden
-- olusturulabilir.

CREATE UNIQUE INDEX IF NOT EXISTS uq_questions_user_order
  ON public.questions (user_id, order_num);
