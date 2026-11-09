-- 083_messages_rls_katilimci.sql
-- messages: RLS aç + yalnız AKTİF eşleşmenin katılımcısına, SİLİNMEMİŞ mesaj için SELECT policy + anon SELECT iptali.
-- 2.0.18 P0 güvenlik maddesi 1, adım 2/2. 082 (matches) uygulanıp yeşil/kırmızı re-test geçtikten SONRA.
--
-- ÖNKOŞUL: 082 ile aynı (token ucu + env canlı, mobil 2.0.18 setAuth, asgari sürüm 2.0.18) + 082 yeşil.
--
-- GEREKÇE (canlı ölçüldü, 2026-11-09): RLS kapalı, 0 policy, anon + authenticated tablo seviyesinde SELECT.
--   Publishable/anon anahtarla `GET /rest/v1/messages?select=content` → 200, tüm mesaj içeriği okunuyor
--   (256 satır). Realtime `matches:messages` / `chat:<id>` kanallarına herhangi bir match_id ile abone olunabiliyor.
--
-- NEDEN GÜVENLİ:
--   * qulo-server service_role (rolbypassrls): mesaj gönderme/listeleme/okundu yolları etkilenmez.
--   * Mobil `messages` tablosunu yalnız Realtime ile okur. Kanallar (qulov2, 2026-11-09):
--       - match_provider `matches:messages` INSERT, filter match_id=in.(kendi eşleşmeleri)
--       - match_provider `matches:read`     UPDATE, filter match_id=in.(kendi eşleşmeleri)
--       - chat_realtime_mixin `chat:<matchId>` INSERT, filter match_id=eq.<matchId>
--     Hepsinde abone katılımcıdır, policy satırı teslim eder. Katılımcı olmayan match_id ile abone olan
--     hiçbir olay almaz.
--   * Alt sorgu matches'i authenticated olarak okur. 082 policy'si katılımcıya izin verdiği için tutarlı.
--     idx_matches_* + matches_pkey ile eşleşme id'si üzerinden tek satır okunur.
--   * Sunucu kuralıyla aynı: getMessages `deleted_at IS NULL` + aktif eşleşme (verifyMatchAccess → MATCH_INACTIVE).
--     Soft delete (deleted_at set eden UPDATE) karşı tarafa Realtime ile akmaz. Mobil silmeyi Realtime'dan
--     işlemiyor: chat yalnız INSERT dinliyor, `matches:read` yalnız read_at'e bakıyor. Bu yüzden kırılan akış yok.
--     Okundu UPDATE'i silinmemiş mesajda olduğu için teslim edilir. Ban eşleşmeleri pasifleştirdiği için banlı
--     kullanıcının teslimatı da anında kesilir. `m.is_active` 082'den bağımsız tekrarlanır, 082 geri alınsa da 083 doğru kalır.
--   * Kolon grant'ları değişmez (authenticated tüm 10 kolonda SELECT, mobil MessageModel bunları okur).
--
-- Geri alma: 083_messages_rls_katilimci_rollback.sql (yalnız YEŞİL regresyonda).

BEGIN;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY messages_katilimci_select ON public.messages
  FOR SELECT
  TO authenticated
  USING (
    messages.deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.matches m
      WHERE m.id = messages.match_id
        AND m.is_active
        AND (select auth.uid()) IN (m.user1_id, m.user2_id)
    )
  );

REVOKE SELECT ON public.messages FROM anon;

COMMIT;

-- Re-test (uygulamadan sonra, baseline ile diff):
--   KIRMIZI: curl -I "$URL/rest/v1/messages?select=id&limit=0" -H "apikey: $(cat <pub.key>)" -H "Prefer: count=exact"
--            → 401 beklenir (bugün 206 */256). `select=content` → 401 (bugün 200).
--   KIRMIZI: anon Realtime `chat:<başkasının match_id'si>` → olay yok.
--   YEŞİL:   mobil 2.0.18 iki cihaz: karşı tarafın mesajı sohbette + listede anlık düşüyor, okundu bilgisi geliyor.
--   YEŞİL:   sunucu GET /api/v1/chat/:matchId/messages 200, POST mesaj 201.
--   SQL:     npx tsx scripts/sql-checks/realtime-rls-policies.ts
