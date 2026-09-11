-- 053_spatial_ref_sys_anon_iptal.sql
--
-- !!! SONUC (prod, 2026-09-11 04:56 UTC): ETKISIZ KALDI. Migration kaydi prod'da var
-- (20260911045650) ama REVOKE hicbir seyi degistirmedi: relacl ayni, anon DELETE/PATCH
-- hala 204. Sebep: tablo supabase_admin sahipli, postgres'in ACL girdisinde grant option
-- (*) yok -> Postgres WARNING "no privileges could be revoked" ile sessizce gecer.
-- Rollback GEREKMEZ (durum degismedi). Kalici cozum backlog: postgis'i `extensions`
-- semasina tasima (drop+create, quiz_sessions.start_location'a bagimli; bakim penceresi).
-- Kalan risk: yalnizca DoS (SRID 4326 silinirse geography fonksiyonlari patlar); tablo
-- icerigi kamuya acik referans verisi, gizlilik riski yok.
--
-- PostGIS referans tablosu `spatial_ref_sys` (8500 satir, kamuya acik veri) RLS'siz ve
-- anon/authenticated tam DML yetkili (canli olcum 2026-09-11: anon DELETE -> 204).
-- Icerik gizli degil; risk DoS: SRID 4326 satiri silinirse `anti_cheat_proximity_hit`
-- (ST_DWithin/ST_Distance geography) "Cannot find SRID (4326)" ile patlar.
--
-- Sahibi supabase_admin; `postgres` uye DEGIL ve ACL'de grant option yok. Bu yuzden RLS
-- acilamaz ve REVOKE'un tutmasi belirsiz — kanit: uygulama sonrasi kirmizi test
-- (anon DELETE) 401/403 donmeli; hala 204 ise migration etkisiz kalmistir -> backlog
-- (postgis'i `extensions` semasina tasima). Yazma yetkisi alinir, SELECT birakilir
-- (PostGIS fonksiyonlari cagiran rol adina spatial_ref_sys okur).
--
-- Geri alma: 053_spatial_ref_sys_anon_iptal_rollback.sql

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.spatial_ref_sys FROM PUBLIC, anon, authenticated;
