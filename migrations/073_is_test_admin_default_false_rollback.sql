-- 073 rollback · default'u drift öncesi bilinmeyen değere değil, canlıda tespit edilen
-- durum olan `true`'ya döndürür. Yalnız acil durum içindir; drift'in kendisi bug'dı.

ALTER TABLE public.users
  ALTER COLUMN is_test_admin SET DEFAULT true;
