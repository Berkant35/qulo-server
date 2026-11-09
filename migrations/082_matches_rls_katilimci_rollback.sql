-- 082_matches_rls_katilimci_rollback.sql
-- SADECE yeşil (uygulama) testlerinde regresyon görülürse çalıştırılır.
-- matches'i 082 öncesine döndürür: policy yok, RLS kapalı, anon SELECT var (051 sonrası hal).
-- UYARI: geri alınca sohbet grafiği yeniden anon'a açılır; sebep çözülünce 082 tekrar uygulanmalı.
-- Policy adı 082/083 ile aynı: koşul (is_active, deleted_at) değişse de DROP POLICY onu kaldırır.

BEGIN;

GRANT SELECT ON public.matches TO anon;

DROP POLICY IF EXISTS matches_katilimci_select ON public.matches;

ALTER TABLE public.matches DISABLE ROW LEVEL SECURITY;

COMMIT;
