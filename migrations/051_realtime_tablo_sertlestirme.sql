-- 051_realtime_tablo_sertlestirme.sql
-- Realtime tablolari (users, messages, matches) icin anon/authenticated
-- sertlestirmesi. 041'in yerine gecer (041 = sadece yazma iptali; 051 = yazma
-- iptali + users hassas kolon okuma iptali).
--
-- SORUN (canli olculdu, 2026-09-10, anon key ile):
--   * users/messages/matches RLS KAPALI (relrowsecurity=false), 0 policy, ucu de
--     supabase_realtime yayininda. Anon key mobil binary'de gomulu
--     (qulov2/lib/core/config/env.dart:8) — APK/IPA'dan cikarilabilir.
--   * Anon key ile REST uzerinden OLCULEN durum:
--       GET /users?select=password_hash  -> 37 satir (206)
--       GET /users?select=verify_token   -> 16 satir (206)
--       GET /users?select=email,lat,lng,push_token -> 188/140/149 satir
--       PATCH /users?id=eq.<uuid>        -> 204 (yazma basarili)
--       DELETE /messages?id=eq.<uuid>    -> 204 (silme basarili)
--   Yani anon key'i cikaran biri tum kullanicilarin parola hash'ini, e-postasini,
--   dogrulama token'ini, push token'ini ve TAM GPS konumunu okuyabilir; ayrica
--   kullanicilari/mesajlari/eslesmeleri degistirebilir veya silebilir (TRUNCATE dahil).
--
-- NEDEN RLS ACAMIYORUZ: Uygulama Supabase Auth kullanmiyor (auth.users = 0 satir);
--   kendi JWT'sini qulo-server uretiyor. Mobil realtime'a anon key ile baglaniyor,
--   dolayisiyla auth.uid()'e dayali policy yazilamaz. Policy'siz RLS acmak realtime
--   teslimatini tamamen keser. Bu yuzden kontrol GRANT tabanlidir.
--
-- NEDEN GUVENLI (yapisal + davranissal kanit):
--   * Mobil (qulov2/lib) Supabase client'ini YALNIZCA realtime kanallari icin
--     kullaniyor: `.from()`, `.rpc()`, `.storage` cagrisi YOK (grep dogrulandi).
--     Tum REST/yazma qulo-server'a gidiyor (service_role, rolbypassrls=true).
--   * users realtime callback'i SADECE `id` + `is_online` okuyor
--     (match_provider.dart:368 _onUserStatusChange). Bu yuzden asagida users
--     SELECT'i (id, is_online, last_seen_at) kolonlarina daraltiliyor; realtime
--     cevrimici durumu calismaya devam eder, hassas kolonlar hem REST hem realtime
--     payload'undan duser (realtime.apply_rls has_column_privilege kullanir).
--   * messages/matches SELECT'i ACIK BIRAKILIYOR: sohbet realtime'i mesaj icerigini
--     teslim etmek zorunda. Mesaj icerigi hala anon key ile okunabilir — bu MIMARI
--     bir aciktir (cozumu: realtime'i kullanici-basi JWT'ye tasimak). Ayri is olarak
--     yol haritasina birakildi; bu migration onu KAPATMAZ, sadece yazma+kimlik
--     sizintisini kapatir.
--
-- YAZMA GERI ALINMASI (== eski 041): mobil bu tablolara anon ile yazmiyor,
--   server service_role kullaniyor; dolayisiyla yazma iptali hicbir uygulama
--   yolunu etkilemez.
--
-- Geri alma: 051_realtime_tablo_sertlestirme_rollback.sql
-- Uygulama once Supabase branch'inde, sonra prod'da; her adimda RUNBOOK ile test.

BEGIN;

-- ── Bolum A: Yazma yetkisini iptal et (users, messages, matches) ──
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.messages, public.matches, public.users
  FROM anon, authenticated;

-- ── Bolum B: users okumasini yalnizca presence kolonlarina daralt ──
REVOKE SELECT ON public.users FROM anon, authenticated;
GRANT  SELECT (id, is_online, last_seen_at) ON public.users TO anon, authenticated;

COMMIT;

-- NOT: messages ve matches SELECT'i bilincli olarak dokunulmadi (realtime sohbet
-- teslimati icin gerekli). Mesaj/eslesme icerigi hala anon ile okunabilir —
-- kalici cozum icin "realtime kullanici-basi auth" yol haritasi maddesine bak.
