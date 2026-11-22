-- 085 rollback · is_store_bot kolonunu kaldırır.
-- ÖNCE sunucu kodunu geri al: auth.service insert'i bu kolonu yazar, kolon yokken kayıt patlar.

ALTER TABLE public.users
  DROP COLUMN IF EXISTS is_store_bot;
