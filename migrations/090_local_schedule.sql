-- 090_local_schedule.sql
-- Qulo 2.2.0 A6 (yerel bildirim senkronu): istemci "su kurallari yerelde planladim" der, sunucu motoru
-- o kullanici icin AYNI konulu kurali `until`'e dek atlar (cift bildirim onleme).
--   users.local_schedule        jsonb  {"rules":["quiz_unfinished",...],"until":"ISO8601"} | NULL (= plan yok)
--   app_config.local_schedule_enabled boolean NOT NULL DEFAULT false  (uzaktan acma anahtari, fail-closed)
--
-- Saklama kararı: users'ta tek jsonb kolon. Motor zaten her turda users'i okur (loadAllUsers) → ek sorgu YOK;
-- ayri tablo her tur +1 tarama ve ek RLS yuzeyi olurdu. NULL satirlar (cogunluk) ek yer/egress tutmaz.
-- RLS/GRANT: yeni tablo yok, politika degismez; kolon mevcut users politikalarini miras alir, yazma yalniz
-- sunucudan (service_role) yapilir.
--
-- !! UYGULAMA SIRASI: bu migration, A6 sunucu kodu (release/2.2.0) yayinlanmadan ONCE uygulanir. Yeni kod
-- motor sorgusuna `local_schedule` kolonunu ekler; kolon yoksa PostgREST tum kullanici okumasini reddeder
-- ve bildirim motoru calismaz. Kolon ekleme eski kodu bozmaz. Rollback: 090_local_schedule_rollback.sql.
BEGIN;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS local_schedule jsonb;
COMMENT ON COLUMN public.users.local_schedule IS
  'Istemcinin yerel planladigi bildirim kurallari: {"rules":[...],"until":ISO}. NULL = plan yok. Motor until gecene dek ayni konulu kurali atlar.';

ALTER TABLE public.app_config ADD COLUMN IF NOT EXISTS local_schedule_enabled boolean NOT NULL DEFAULT false;

COMMIT;
