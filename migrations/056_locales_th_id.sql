-- 056_locales_th_id.sql
-- Tayca (th) ve Endonezce (id) dil destegi (2026-09-14). Uc CHECK constraint'i
-- SUPPORTED_LOCALES (constants/locales.ts, 18 dil) ile hizalanir:
--   user_languages.language_code (043), users.locale (044), questions.locale (055).
-- Parity testi: tests/services/user-language.service.test.ts bu dosyayi okur.
-- Yeni dil eklerken bu dosyanin devamini (057...) ayni kalipla yaz.

BEGIN;

ALTER TABLE user_languages
  DROP CONSTRAINT IF EXISTS user_languages_language_code_check;
ALTER TABLE user_languages
  ADD CONSTRAINT user_languages_language_code_check
  CHECK (language_code = ANY (ARRAY[
    'tr', 'en', 'de', 'fr', 'es', 'ar', 'ru',
    'pt', 'it', 'ja', 'ko', 'zh', 'nl', 'pl', 'sv', 'hi',
    'th', 'id'
  ]));

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_locale_check;
ALTER TABLE users
  ADD CONSTRAINT users_locale_check
  CHECK (locale = ANY (ARRAY[
    'tr', 'en', 'de', 'fr', 'es', 'ar', 'ru',
    'pt', 'it', 'ja', 'ko', 'zh', 'nl', 'pl', 'sv', 'hi',
    'th', 'id'
  ]));

ALTER TABLE questions
  DROP CONSTRAINT IF EXISTS questions_locale_check;
ALTER TABLE questions
  ADD CONSTRAINT questions_locale_check
  CHECK (locale = ANY (ARRAY[
    'tr', 'en', 'de', 'fr', 'es', 'ar', 'ru',
    'pt', 'it', 'ja', 'ko', 'zh', 'nl', 'pl', 'sv', 'hi',
    'th', 'id'
  ]));

COMMIT;
