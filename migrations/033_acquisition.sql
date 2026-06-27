-- 033_acquisition.sql — "Bizi nereden duydunuz?" attribution

CREATE TABLE IF NOT EXISTS acquisition_channels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,            -- stabil slug (tiktok, friend, other...)
  label       jsonb NOT NULL,                  -- { "tr": "...", "en": "...", ... } 16 dil
  emoji       text,                            -- görsel (🎵 📸 ...)
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  is_freeform boolean NOT NULL DEFAULT false,  -- true → opsiyonel serbest metin alanı
  created_by  uuid REFERENCES admin_users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_acquisition (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  channel_id    uuid REFERENCES acquisition_channels(id) ON DELETE SET NULL,
  channel_key   text,                          -- cevaplama anındaki key snapshot
  freeform_text text,                          -- is_freeform kanal için opsiyonel
  skipped       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_answered boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_acquisition_channels_active_order ON acquisition_channels(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_user_acquisition_channel ON user_acquisition(channel_key);
CREATE INDEX IF NOT EXISTS idx_user_acquisition_created ON user_acquisition(created_at);

-- Seed: varsayılan kanallar (admin sonradan düzenleyebilir)
INSERT INTO acquisition_channels (key, label, emoji, sort_order, is_freeform) VALUES
  ('tiktok',    '{"tr":"TikTok","en":"TikTok","de":"TikTok","fr":"TikTok","es":"TikTok","ar":"TikTok","ru":"TikTok","pt":"TikTok","it":"TikTok","ja":"TikTok","ko":"TikTok","zh":"TikTok","nl":"TikTok","pl":"TikTok","sv":"TikTok","hi":"TikTok"}', '🎵', 10, false),
  ('instagram', '{"tr":"Instagram","en":"Instagram","de":"Instagram","fr":"Instagram","es":"Instagram","ar":"Instagram","ru":"Instagram","pt":"Instagram","it":"Instagram","ja":"Instagram","ko":"Instagram","zh":"Instagram","nl":"Instagram","pl":"Instagram","sv":"Instagram","hi":"Instagram"}', '📸', 20, false),
  ('twitter',   '{"tr":"X (Twitter)","en":"X (Twitter)","de":"X (Twitter)","fr":"X (Twitter)","es":"X (Twitter)","ar":"X (Twitter)","ru":"X (Twitter)","pt":"X (Twitter)","it":"X (Twitter)","ja":"X (Twitter)","ko":"X (Twitter)","zh":"X (Twitter)","nl":"X (Twitter)","pl":"X (Twitter)","sv":"X (Twitter)","hi":"X (Twitter)"}', '🐦', 30, false),
  ('friend',    '{"tr":"Arkadaş / aile","en":"Friend / family","de":"Freund / Familie","fr":"Ami / famille","es":"Amigo / familia","ar":"صديق / عائلة","ru":"Друг / семья","pt":"Amigo / família","it":"Amico / famiglia","ja":"友人・家族","ko":"친구 / 가족","zh":"朋友 / 家人","nl":"Vriend / familie","pl":"Znajomy / rodzina","sv":"Vän / familj","hi":"दोस्त / परिवार"}', '👥', 40, false),
  ('app_store', '{"tr":"App Store / Google Play","en":"App Store / Google Play","de":"App Store / Google Play","fr":"App Store / Google Play","es":"App Store / Google Play","ar":"App Store / Google Play","ru":"App Store / Google Play","pt":"App Store / Google Play","it":"App Store / Google Play","ja":"App Store / Google Play","ko":"App Store / Google Play","zh":"App Store / Google Play","nl":"App Store / Google Play","pl":"App Store / Google Play","sv":"App Store / Google Play","hi":"App Store / Google Play"}', '📱', 50, false),
  ('google',    '{"tr":"Google araması","en":"Google search","de":"Google-Suche","fr":"Recherche Google","es":"Búsqueda de Google","ar":"بحث جوجل","ru":"Поиск Google","pt":"Pesquisa Google","it":"Ricerca Google","ja":"Google検索","ko":"Google 검색","zh":"Google 搜索","nl":"Google-zoekopdracht","pl":"Wyszukiwarka Google","sv":"Google-sökning","hi":"Google खोज"}', '🔍', 60, false),
  ('other',     '{"tr":"Diğer","en":"Other","de":"Andere","fr":"Autre","es":"Otro","ar":"أخرى","ru":"Другое","pt":"Outro","it":"Altro","ja":"その他","ko":"기타","zh":"其他","nl":"Anders","pl":"Inne","sv":"Annat","hi":"अन्य"}', '✨', 70, true)
ON CONFLICT (key) DO NOTHING;
