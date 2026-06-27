-- 034_acquisition_icon_url.sql — kanal görseli: emoji yerine logo URL (SVG/PNG)

ALTER TABLE acquisition_channels ADD COLUMN IF NOT EXISTS icon_url text;

-- Ünlü platformlara açık kaynak Simple Icons CDN logoları (renkli SVG).
-- friend / other → logo yok, emoji kullanılmaya devam eder.
UPDATE acquisition_channels SET icon_url = 'https://cdn.simpleicons.org/tiktok'    WHERE key = 'tiktok'    AND icon_url IS NULL;
UPDATE acquisition_channels SET icon_url = 'https://cdn.simpleicons.org/instagram' WHERE key = 'instagram' AND icon_url IS NULL;
UPDATE acquisition_channels SET icon_url = 'https://cdn.simpleicons.org/x'         WHERE key = 'twitter'   AND icon_url IS NULL;
UPDATE acquisition_channels SET icon_url = 'https://cdn.simpleicons.org/googleplay' WHERE key = 'app_store' AND icon_url IS NULL;
UPDATE acquisition_channels SET icon_url = 'https://cdn.simpleicons.org/google'    WHERE key = 'google'    AND icon_url IS NULL;
