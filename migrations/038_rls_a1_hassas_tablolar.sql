-- 038_rls_a1_hassas_tablolar.sql
-- RLS Guard / Parti A1 — anon erisimine tamamen kapatilacak hassas tablolar.
--
-- GEREKCE:
-- Anon key mobil uygulamaya gomulu (qulov2/lib/core/config/env.dart:13) ve
-- APK/IPA'dan cikarilabilir. Olcum (2026-09-01): `anon` rolu public semadaki
-- 51 tablonun HEPSINDE SELECT/INSERT/UPDATE/DELETE/TRUNCATE yetkili ve semada
-- TEK BIR RLS policy'si yok. Baseline testinde bu 8 tablonun tamami anon key
-- ile HTTP 200 dondu — yani su an disaridan okunabiliyor.
--
-- En agir kalemler: refresh_tokens (oturum ele gecirme), admin_users (yonetici
-- kayitlari), user_details (kisisel profil verisi).
--
-- NEDEN GUVENLI:
-- `service_role.rolbypassrls = true` (pg_roles ile dogrulandi) — qulo-server
-- service_role key kullaniyor (src/config/supabase.ts:4), dolayisiyla RLS'ten
-- hic etkilenmez. Mobil bu tablolara dogrudan sorgu atmiyor (lib altinda tek
-- bir `.from()` cagrisi yok) ve hicbiri `supabase_realtime` yayininda degil.
--
-- POLICY EKLENMIYOR: RLS acik + policy yok = anon/authenticated icin tam ret.
-- Erisim yalnizca service_role uzerinden, yani qulo-server API'si uzerinden olur.
-- Bu kasitlidir; ilerideki fazlarda client kimligi gerekirse policy eklenecek.
--
-- Geri alma: 038_rls_a1_hassas_tablolar_rollback.sql

ALTER TABLE public.refresh_tokens            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_details              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_unsubscribe_tokens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocks                    ENABLE ROW LEVEL SECURITY;
