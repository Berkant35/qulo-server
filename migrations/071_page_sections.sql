-- 071_page_sections.sql
-- Sayfa bölümleri (page builder) — Rainbow market vitrini (Plan 4).
-- Spec: qulo/docs/superpowers/specs/2026-09-28-rainbow-market-mobil-ve-sayfa-bolumleri-design.md §4
--
-- Baseline (2026-09-28, prod — list_migrations + information_schema): son migration 070;
-- page_sections / page_section_items / page_section_events YOK; users.has_reward_redemptions YOK;
-- reward_redemptions.source_item_id YOK. (page_messages / page_message_events ayrı özellik, dokunulmaz.)
--
-- Erişim: üç yeni tabloda RLS açık + politika yok + anon/authenticated REVOKE — yalnız service_role
-- (qulo-server) okur/yazar. İstatistik fonksiyonu SECURITY INVOKER + EXECUTE yalnız service_role;
-- REVOKE'a PUBLIC dahil (fonksiyon ACL'indeki `=X` PUBLIC'tir, anon miras alır — 052 dersi).
-- Realtime yayınına EKLENMEZ.
--
-- Kilit kapsamı (069 dersi): işlem içindeki kilitler COMMIT'e kadar tutulur. `reward_redemptions` ve
-- `users` ALTER'ları ACCESS EXCLUSIVE alır → EN SONA konur. `lock_timeout` 3 sn: kilit alınamazsa
-- migration düşer (kuyrukta bekleyip trafiği kilitlemez); IF NOT EXISTS ile tekrar çalıştırmak güvenli.
-- `ADD COLUMN ... DEFAULT false` PG11+ yalnız katalog değişikliğidir (tablo yeniden yazılmaz).
--
-- SIRA: ÖNCE bu migration, SONRA kod. Kod önce giderse `getMe` olmayan `has_reward_redemptions`
-- kolonunu seçer ve HERKES için 500 döner.

BEGIN;

SET LOCAL lock_timeout = '3s';

-- 1) Bölümler. Yeni sayfa = page_key CHECK'ine tek satırlık migration.
CREATE TABLE IF NOT EXISTS page_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_key TEXT NOT NULL CHECK (page_key IN ('rewards_market')),
  section_type TEXT NOT NULL CHECK (section_type IN ('banner_carousel', 'featured_items')),
  heading JSONB NULL CHECK (heading IS NULL OR jsonb_typeof(heading) = 'object'),
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  countries TEXT[] NULL,
  platforms TEXT[] NULL CHECK (platforms IS NULL OR platforms <@ ARRAY['ios', 'android']::TEXT[]),
  locales TEXT[] NULL,
  autoplay_seconds INTEGER NOT NULL DEFAULT 5
    CHECK (autoplay_seconds = 0 OR autoplay_seconds BETWEEN 3 AND 10),
  created_by UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_page_sections_page
  ON page_sections (page_key, sort_order) WHERE deleted_at IS NULL;

-- 2) Kartlar. action_type ↔ hedef kolonu tutarlılığı DB'de de kilitli (servis zod'la da doğrular).
CREATE TABLE IF NOT EXISTS page_section_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES page_sections(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  countries TEXT[] NULL,
  platforms TEXT[] NULL CHECK (platforms IS NULL OR platforms <@ ARRAY['ios', 'android']::TEXT[]),
  locales TEXT[] NULL,
  image_url TEXT NULL CHECK (image_url IS NULL OR image_url LIKE 'https://%'),
  content JSONB NULL CHECK (content IS NULL OR jsonb_typeof(content) = 'object'),
  action_type TEXT NOT NULL DEFAULT 'none' CHECK (action_type IN ('none', 'catalog_item', 'app_route')),
  action_catalog_item_id UUID NULL REFERENCES reward_catalog_items(id),
  action_route TEXT NULL CHECK (action_route IS NULL OR action_route IN
    ('diamonds', 'exchange', 'subscription', 'discover', 'rewards_redemptions')),
  catalog_item_id UUID NULL REFERENCES reward_catalog_items(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT page_section_items_action_target CHECK (
    (action_type = 'none' AND action_catalog_item_id IS NULL AND action_route IS NULL)
    OR (action_type = 'catalog_item' AND action_catalog_item_id IS NOT NULL AND action_route IS NULL)
    OR (action_type = 'app_route' AND action_route IS NOT NULL AND action_catalog_item_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_page_section_items_section
  ON page_section_items (section_id, sort_order);

-- 3) Ölçüm olayları. Aynı kullanıcı + kart + olay + gün bir kez (toplu yazım ON CONFLICT DO NOTHING).
CREATE TABLE IF NOT EXISTS page_section_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id UUID NOT NULL REFERENCES page_section_items(id) ON DELETE CASCADE,
  section_id UUID NOT NULL REFERENCES page_sections(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (event IN ('impression', 'click')),
  country TEXT NULL,
  platform TEXT NULL CHECK (platform IS NULL OR platform IN ('ios', 'android')),
  day DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'utc')::date),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_page_section_events_daily
  ON page_section_events (item_id, user_id, event, day);
CREATE INDEX IF NOT EXISTS idx_page_section_events_item_day
  ON page_section_events (item_id, day);

-- 4) Talep hangi karttan başladı (ölçüm: tıklama → itfa). Fonksiyon gövdesi bu kolonu okur → önce.
ALTER TABLE reward_redemptions
  ADD COLUMN IF NOT EXISTS source_item_id UUID NULL REFERENCES page_section_items(id) ON DELETE SET NULL;

-- 5) İstatistik: kart başına gösterim / tıklama / itfa, ülke + platform kırılımı (JS geçmiş taraması YOK).
--    Silinmiş bölümün kartları sayılmaz. `p_since` UTC; olay günü `day >= p_since`'in UTC tarihi.
CREATE OR REPLACE FUNCTION page_section_item_stats(p_page_key TEXT, p_since TIMESTAMPTZ)
RETURNS TABLE (
  item_id      UUID,
  country      TEXT,
  platform     TEXT,
  impressions  BIGINT,
  clicks       BIGINT,
  redemptions  BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH sayfa_kartlari AS (
    SELECT i.id
    FROM page_section_items i
    JOIN page_sections s ON s.id = i.section_id
    WHERE s.page_key = p_page_key AND s.deleted_at IS NULL
  ),
  satirlar AS (
    SELECT e.item_id, e.country, e.platform,
           (e.event = 'impression')::INT AS gosterim,
           (e.event = 'click')::INT AS tiklama,
           0 AS itfa
    FROM page_section_events e
    JOIN sayfa_kartlari k ON k.id = e.item_id
    WHERE e.day >= (p_since AT TIME ZONE 'utc')::date
    UNION ALL
    SELECT r.source_item_id, r.country_code, r.platform, 0, 0, 1
    FROM reward_redemptions r
    JOIN sayfa_kartlari k ON k.id = r.source_item_id
    WHERE r.created_at >= p_since
  )
  SELECT satirlar.item_id, satirlar.country, satirlar.platform,
         SUM(gosterim)::BIGINT, SUM(tiklama)::BIGINT, SUM(itfa)::BIGINT
  FROM satirlar
  GROUP BY satirlar.item_id, satirlar.country, satirlar.platform;
$$;

COMMENT ON FUNCTION page_section_item_stats(TEXT, TIMESTAMPTZ) IS
  'Backoffice sayfa bölümleri ölçüm tablosu (Plan 4). Yalnız service_role.';

-- 6) Erişim
ALTER TABLE page_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_section_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_section_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON page_sections FROM anon, authenticated;
REVOKE ALL ON page_section_items FROM anon, authenticated;
REVOKE ALL ON page_section_events FROM anon, authenticated;
REVOKE ALL ON SEQUENCE page_section_events_id_seq FROM anon, authenticated;
REVOKE ALL ON FUNCTION page_section_item_stats(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION page_section_item_stats(TEXT, TIMESTAMPTZ) TO service_role;

-- 7) Kullanıcı bayrağı — EN SON (`users` ACCESS EXCLUSIVE kilidi COMMIT'e kadar yalnız milisaniyeler).
--    Talebi olan kullanıcılar geriye dönük işaretlenir (tek yönlü bayrak; ilk itfada servis yazar).
ALTER TABLE users ADD COLUMN IF NOT EXISTS has_reward_redemptions BOOLEAN NOT NULL DEFAULT false;

UPDATE users SET has_reward_redemptions = true
WHERE has_reward_redemptions = false
  AND id IN (SELECT DISTINCT user_id FROM reward_redemptions WHERE user_id IS NOT NULL);

COMMIT;
