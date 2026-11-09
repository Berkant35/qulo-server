-- 082_matches_rls_katilimci.sql
-- matches: RLS aç + yalnız katılımcıya ve AKTİF eşleşmeye SELECT policy + anon SELECT iptali.
-- 2.0.18 P0 güvenlik maddesi 1, adım 1/2 (sonra 083 messages). Tablo başına AYRI migration.
--
-- ÖNKOŞUL (sıra ZORUNLU; bozulursa sohbet listesindeki yeni eşleşme bildirimi kesilir):
--   1. qulo-server POST /api/v1/realtime/token canlı + imzalayıcı env'i Railway'de
--      (log: "[realtime-token] signer=es256" ya da "hs256", "disabled" DEĞİL).
--   2. Mobil 2.0.18 yayında: Realtime'a `setAuth(<realtime token>)` ile bağlanıyor ve süre dolmadan yeniliyor.
--   3. Asgari sürüm 2.0.18'e yükseltildi. Eski sürümler anon bağlandığı için bu migration'dan sonra
--      `matches:new` olayı ALAMAZ. Sürüm kapısı bu yüzden önce gelir.
--   4. Baseline: docs/security/2026-09-10-guvenlik-denetimi.md "2026-11-09" baseline (yeşil + kırmızı) yeniden alındı.
--
-- GEREKÇE (canlı ölçüldü, 2026-11-09): RLS kapalı, 0 policy, anon + authenticated tablo seviyesinde SELECT.
--   Publishable/anon anahtarla `GET /rest/v1/matches` → 206, tüm eşleşme grafiği okunuyor (242 satır).
--   Realtime `matches:new` kanalı filtresiz, bu yüzden her anon istemci HERKESİN yeni eşleşmesini alıyor.
--
-- NEDEN GÜVENLİ:
--   * qulo-server service_role kullanır (rolbypassrls): RLS ve REVOKE sunucu yollarını etkilemez.
--   * Mobil `matches` tablosunu yalnız Realtime ile okur (`.from()` yok, grep 2026-11-09). Kanal:
--     `matches:new` INSERT, filtresiz → policy, satırı yalnız user1_id/user2_id = sub olan aboneye teslim eder.
--   * Web (web/) Supabase'e doğrudan bağlanmaz.
--   * `authenticated` rolü diğer tüm public tablolarda RLS açık + 0 policy (= erişim yok). Kullanıcıya
--     authenticated token vermek bu tablolar dışında yetki genişletmez (2026-11-09 SQL denetimi).
--
-- `is_active` koşulu sunucu kuralıyla aynı: getMatches yalnız aktif eşleşmeyi listeler, chat erişimi
-- MATCH_INACTIVE ile reddeder. Unmatch, engelleme (block.service) ve ban (ban.service) satırı is_active=false yapar.
-- Bundan sonra o satır Realtime'dan akmaz. Mobil matches UPDATE dinlemiyor (yalnız `matches:new` INSERT; unmatch'i
-- API'nin MATCH_INACTIVE hatasından öğreniyor, grep 2026-11-09), bu yüzden is_active=false güncellemesinin
-- teslim edilmemesi hiçbir akışı bozmaz. INSERT'te is_active varsayılanı true, yeni eşleşme teslim edilir.
--
-- Policy `auth.uid()` = JWT `sub` (qulo-server users.id, uuid). `(select auth.uid())` ifadesi satır başına
-- değil sorgu başına bir kez hesaplanır (Supabase RLS performans önerisi).
--
-- Geri alma: 082_matches_rls_katilimci_rollback.sql (yalnız YEŞİL regresyonda).

BEGIN;

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY matches_katilimci_select ON public.matches
  FOR SELECT
  TO authenticated
  USING (is_active AND (select auth.uid()) IN (user1_id, user2_id));

REVOKE SELECT ON public.matches FROM anon;

COMMIT;

-- Re-test (uygulamadan sonra, baseline ile diff):
--   KIRMIZI: curl -I "$URL/rest/v1/matches?select=id&limit=0" -H "apikey: $(cat <pub.key>)" -H "Prefer: count=exact"
--            → 401 (42501 permission denied) beklenir (bugün 206 */242).
--   KIRMIZI: anon Realtime `matches:new` → abonelik reddi ya da hiç olay yok.
--   YEŞİL:   mobil 2.0.18 iki cihaz: yeni eşleşme listeye düşüyor (iOS + Android ayrı).
--   YEŞİL:   sunucu GET /api/v1/matches 200 (service_role, etkilenmez).
--   SQL:     npx tsx scripts/sql-checks/realtime-rls-policies.ts → geri alınan işlemde katılımcı/yabancı/anon sayımı.
