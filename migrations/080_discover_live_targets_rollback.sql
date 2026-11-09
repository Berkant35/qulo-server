-- 080 rollback · Discover canli hedef anahtarlari + recall e-posta anahtari + cevapsiz eslesme RPC'si.
--
-- Sira: kod bu kolonlari/RPC'yi toleransli okur (kolon yok → varsayilan, RPC yok → tavan uygulanmaz,
-- e-posta anahtari yok → KAPALI). Bu yuzden rollback once de calistirilabilir; davranis:
--   * 30+ gun dislamasi varsayilan 30 ile, cevapsiz tavan varsayilan 3 ile devam eder ama RPC
--     dustugu icin tavan hic uyusmaz (log: [matching] unanswered RPC);
--   * recall e-postasi KAPALI kalir.
-- discover_dormant_days 074'un varsayilani 14'e geri alinir (kolon 074'e aittir, burada dusurulmez).

BEGIN;

DROP FUNCTION IF EXISTS discover_unanswered_match_counts(timestamptz, timestamptz, integer);

ALTER TABLE public.app_config
  DROP COLUMN IF EXISTS discover_inactive_exclude_days,
  DROP COLUMN IF EXISTS discover_unanswered_match_cap,
  DROP COLUMN IF EXISTS recall_email_enabled;

UPDATE public.app_config SET discover_dormant_days = 14;

COMMIT;
