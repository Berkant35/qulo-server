-- 080 · Discover canli hedef onceligi + "seni cozduler" e-posta anahtari (2.0.18 plan madde 5-6).
--
-- Neden (prod 2026-11-09): 10-01'den beri 208 gercek eslesmenin yalniz 4'u iki tarafli konusmaya
-- dondu. Hedeflerin %79'u eslesme aninda >=3 gundur gorulmemisti; eslesmeler 53 hedefte yigildi
-- (tek hedefe 21). Bu migration Discover'a uc ayar ve bir sayim fonksiyonu ekler:
--
--   discover_dormant_days (074) = 3   : bu kadar gundur gorulmeyen aday listenin SONUNA (sert filtre degil).
--   discover_inactive_exclude_days = 30 : bu kadar gundur gorulmeyen aday desteden CIKAR. 0 = kapali.
--   discover_unanswered_match_cap = 3  : son 30 gunde bu kadar cevapsiz (kendisinin hic yazmadigi)
--                                        aktif eslesmesi olan aday listenin sonuna. 0 = kapali.
--   recall_email_enabled = false       : bildirim motorunun "seni cozduler" kuralinin push token'i
--                                        OLMAYAN hedefe e-posta yedegi. Gercek e-posta gonderir —
--                                        VARSAYILAN KAPALI; acma karari kullanicida.
--
-- Prod olcumu (bugun aktif 20 izleyici, yaklasik deste): ortalama 48,7 → 29,5 kart (30 gun dislamasi);
-- bos deste 5 → 5 (yeni bos deste yok).
--
-- discover_unanswered_match_counts: [p_since, p_until) araligindaki aktif eslesmeleri tek geciste sayar
-- (kod: son 30 gun, en yeni 24 saat HARIC — taze eslesmeye cevap verme payi), yalniz esigi asan
-- kullanicilari dondurur (kucuk sonuc, id listesi YOK → URL siniri yok). Kod 5 dk surec ici
-- onbellekle cagirir (istek basina DB yok). SECURITY INVOKER + EXECUTE yalniz service_role.
--
-- 074 bu migration'dan ONCE uygulanmis olmali (discover_dormant_days kolonu).
-- Rollback: 080_discover_live_targets_rollback.sql

BEGIN;

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS discover_inactive_exclude_days integer NOT NULL DEFAULT 30
    CONSTRAINT app_config_discover_inactive_exclude_days_range CHECK (discover_inactive_exclude_days BETWEEN 0 AND 365),
  ADD COLUMN IF NOT EXISTS discover_unanswered_match_cap integer NOT NULL DEFAULT 3
    CONSTRAINT app_config_discover_unanswered_match_cap_range CHECK (discover_unanswered_match_cap BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS recall_email_enabled boolean NOT NULL DEFAULT false;

UPDATE public.app_config SET discover_dormant_days = 3;

CREATE OR REPLACE FUNCTION discover_unanswered_match_counts(p_since timestamptz, p_until timestamptz, p_min integer)
RETURNS TABLE (user_id uuid, unanswered integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT taraf.uid, count(*)::integer
    FROM matches m
   CROSS JOIN LATERAL (VALUES (m.user1_id), (m.user2_id)) AS taraf(uid)
   WHERE m.is_active
     AND m.matched_at >= p_since
     AND m.matched_at <  p_until
     AND NOT EXISTS (
       SELECT 1 FROM messages x
        WHERE x.match_id = m.id
          AND x.sender_id = taraf.uid
     )
   GROUP BY taraf.uid
  HAVING count(*) >= GREATEST(p_min, 1);
$$;

COMMENT ON FUNCTION discover_unanswered_match_counts(timestamptz, timestamptz, integer) IS
  'Discover cevapsiz eslesme tavani: [p_since, p_until) araligindaki aktif eslesmelerinde hic mesaj atmamis, en az p_min tane olan kullanicilar. Migration 080.';

REVOKE ALL ON FUNCTION discover_unanswered_match_counts(timestamptz, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION discover_unanswered_match_counts(timestamptz, timestamptz, integer) TO service_role;

COMMIT;
