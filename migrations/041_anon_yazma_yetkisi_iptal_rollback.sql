-- 041_anon_yazma_yetkisi_iptal_rollback.sql
-- SADECE yesil (uygulama) testlerinde regresyon gorulurse calistirilir.
-- DIKKAT: bu, anon rolune yazma yetkisini GERI VERIR — yalnizca gercek bir
-- regresyon kanitlandiginda kullanilmali.

GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.messages, public.matches, public.users
  TO anon, authenticated;
