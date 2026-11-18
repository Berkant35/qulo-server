-- 088 · rewarded_ad_claims — günlük ödüllü reklam (AdMob SSV) ödül talepleri (2.2.0 kalem B3).
--
-- AMAÇ: çift ödülü DB seviyesinde engellemek. `diamond_transactions` benzersiz indeksi (047) yalnız
-- SUBSCRIPTION_BONUS / IAP_PURCHASE kapsar; REWARDED_AD için read-then-write yarışa açıktır. Önce bu
-- tabloya talep yazılır (atomik), sonra addPurple çağrılır:
--   · transaction_id PRIMARY KEY  -> aynı Google işlemi ikinci kez ödül vermez
--   · UNIQUE (user_id, day, slot) -> kullanıcı başına günlük sınır (slot 1..dailyLimit)
--
-- GÜVENLİK: RLS AÇIK, HİÇ POLİTİKA YOK; tabloya yalnız service_role (qulo-server) erişir.
-- Rollback: 088_rewarded_ad_claims_rollback.sql. Uygulama: 2.2.0 yayınında; uygulanmadan sunucu
-- ödül VERMEZ (talep yazılamaz -> 500, Google yeniden dener) ve /status available=false döner.

BEGIN;

CREATE TABLE IF NOT EXISTS public.rewarded_ad_claims (
  transaction_id text        PRIMARY KEY,
  user_id        uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  day            date        NOT NULL,
  slot           smallint    NOT NULL CHECK (slot BETWEEN 1 AND 5),
  reference_id   text        NOT NULL,
  amount         integer     NOT NULL CHECK (amount > 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rewarded_ad_claims_user_day_slot_uq UNIQUE (user_id, day, slot)
);

ALTER TABLE public.rewarded_ad_claims ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rewarded_ad_claims FROM anon, authenticated;

COMMIT;
