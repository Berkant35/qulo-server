-- 053_spatial_ref_sys_anon_iptal_rollback.sql
-- NOT: 053 prod'da etkisiz kaldi (bkz. 053 basligi); bu rollback hicbir zaman gerekmedi.
-- SADECE yesil regresyonda (anti_cheat_proximity_hit / discover kirildiysa) calistirilir.
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.spatial_ref_sys TO anon, authenticated;
