-- 083_messages_rls_katilimci_rollback.sql
-- SADECE yeşil (uygulama) testlerinde regresyon görülürse çalıştırılır.
-- messages'ı 083 öncesine döndürür: policy yok, RLS kapalı, anon SELECT var.
-- UYARI: geri alınca tüm mesaj içeriği yeniden anon'a açılır; sebep çözülünce 083 tekrar uygulanmalı.
-- 082 bağımsızdır, bu rollback onu geri almaz.

BEGIN;

GRANT SELECT ON public.messages TO anon;

DROP POLICY IF EXISTS messages_katilimci_select ON public.messages;

ALTER TABLE public.messages DISABLE ROW LEVEL SECURITY;

COMMIT;
