-- 054_preferred_languages_tek_kaynak_rollback.sql
-- 054'u geri alir: veri yedekten (sutun + user_languages), varsayilan ARRAY['tr'],
-- RPC 043 haline (yalniz tablo, RETURNS void). Yedek tablo denetim izi olarak kalir.

BEGIN;

UPDATE users u
SET preferred_languages = b.old_preferred_languages
FROM _backup_054_preferred_languages b
WHERE b.user_id = u.id;

DELETE FROM user_languages ul
USING _backup_054_preferred_languages b
WHERE ul.user_id = b.user_id;

INSERT INTO user_languages (user_id, language_code)
SELECT b.user_id, unnest(b.old_user_languages)
FROM _backup_054_preferred_languages b
ON CONFLICT (user_id, language_code) DO NOTHING;

ALTER TABLE users
  ALTER COLUMN preferred_languages SET DEFAULT ARRAY['tr'];

DROP FUNCTION IF EXISTS set_user_languages(uuid, text[]);

CREATE FUNCTION set_user_languages(p_user_id uuid, p_languages text[])
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM user_languages WHERE user_id = p_user_id;
  INSERT INTO user_languages (user_id, language_code)
  SELECT p_user_id, unnest(p_languages)
  ON CONFLICT (user_id, language_code) DO NOTHING;
$$;

REVOKE ALL ON FUNCTION set_user_languages(uuid, text[]) FROM PUBLIC, anon, authenticated;

COMMIT;
