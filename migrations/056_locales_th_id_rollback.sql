-- 056_locales_th_id_rollback.sql — 16 dile doner. th/id satiri varsa ADD CONSTRAINT patlar; raporla.
-- Teshis (ADD CONSTRAINT patlarsa once bunlari calistir, satirlari tasi/temizle, sonra tekrar dene):
--   SELECT count(*) FROM users          WHERE locale IN ('th','id');
--   SELECT count(*) FROM user_languages WHERE language_code IN ('th','id');
--   SELECT count(*) FROM questions      WHERE locale IN ('th','id');
BEGIN;

ALTER TABLE user_languages DROP CONSTRAINT IF EXISTS user_languages_language_code_check;
ALTER TABLE user_languages ADD CONSTRAINT user_languages_language_code_check
  CHECK (language_code = ANY (ARRAY['tr','en','de','fr','es','ar','ru','pt','it','ja','ko','zh','nl','pl','sv','hi']));

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_locale_check;
ALTER TABLE users ADD CONSTRAINT users_locale_check
  CHECK (locale = ANY (ARRAY['tr','en','de','fr','es','ar','ru','pt','it','ja','ko','zh','nl','pl','sv','hi']));

ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_locale_check;
ALTER TABLE questions ADD CONSTRAINT questions_locale_check
  CHECK (locale = ANY (ARRAY['tr','en','de','fr','es','ar','ru','pt','it','ja','ko','zh','nl','pl','sv','hi']));

COMMIT;
