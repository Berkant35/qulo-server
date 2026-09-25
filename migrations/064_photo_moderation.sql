-- 064: Profil fotografi moderasyonu + ban bildirimi/itiraz (2026-09-25)
-- Cron (photo-moderation) NVIDIA NIM gorsel modeliyle gercek kullanicilarin fotograflarini
-- tarar; cinsel icerik kesinlesirse hesap banlanir, kullaniciya e-posta gider ve e-postadaki
-- tek kullanimlik baglantiyla itiraz edebilir. Itiraz gelince admin'e e-posta duser.
BEGIN;

-- Kalici kill-switch: seed_reply_enabled ile ayni desen, her tikta okunur.
ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS photo_moderation_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Her fotograf URL'si bir kez siniflandirilir (photo_url UNIQUE). verdict:
--   safe     : temiz
--   explicit : iki asamali kontrol de cinsel icerik dedi -> kullanici banlandi
--   review   : ilk model supheli, dogrulama modeli katilmadi (veya cok buyuk dosya) -> admin baksin
--   error    : indirme/NIM hatasi; cron 1 saat sonra yeniden dener
CREATE TABLE IF NOT EXISTS photo_moderation_checks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  photo_url   TEXT NOT NULL UNIQUE,
  verdict     TEXT NOT NULL CHECK (verdict IN ('safe', 'explicit', 'review', 'error')),
  reason      TEXT,
  model       TEXT,
  -- Deneme sayisi: 3 hatadan sonra cron satiri 'review'a dusurur (zombi dosya butceyi yemesin).
  attempts    INTEGER NOT NULL DEFAULT 1,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_photo_moderation_checks_user ON photo_moderation_checks(user_id);
CREATE INDEX IF NOT EXISTS idx_photo_moderation_checks_open
  ON photo_moderation_checks(verdict, checked_at) WHERE verdict IN ('review', 'error');

-- Ban e-postasindaki itiraz baglantisi: token tek kullanimlik.
CREATE TABLE IF NOT EXISTS ban_appeals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,
  ban_reason    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'resolved')),
  message       TEXT,
  submitted_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ban_appeals_user ON ban_appeals(user_id);

-- Yalniz service_role (qulo-server) okur/yazar; anon/authenticated icin policy YOK.
ALTER TABLE photo_moderation_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ban_appeals ENABLE ROW LEVEL SECURITY;

COMMIT;
