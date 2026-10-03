-- 074 · app_config.discover_dormant_days — Discover'da "uyuyan" hesap esigi (gun).
--
-- Neden: 29 Eyl-3 Eki kohortunda 15 eslesmenin yalniz 2'sinde karsi taraf yanit verdi;
-- kohort disindaki 8 karsi tarafin 7'si en son Haziran-Eylul arasi gorulmustu (last_seen_at).
-- Discover bu esikten uzun suredir gorulmeyen adaylari gercek aktif adaylarin ARKASINA
-- siralar (sert filtre degil — havuz kucuk, bos Discover'a dusurmez).
-- 0 = kapali (siralama eskisi gibi). Varsayilan 14 gun.
--
-- Kod bu kolonu toleransli okur: migration uygulanmadan deploy edilirse 14 kullanilir.

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS discover_dormant_days integer NOT NULL DEFAULT 14
  CONSTRAINT app_config_discover_dormant_days_range CHECK (discover_dormant_days BETWEEN 0 AND 365);
