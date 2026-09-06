-- 043 rollback — set_user_languages fonksiyonunu kaldirir, constraint'i 15 dile dondurur.
--
-- SIRA: ONCE sunucu onceki surume alinmali (servis rpc yerine delete+insert'e doner),
-- SONRA bu dosya. Aksi halde PUT /me/languages "function does not exist" ile 500 doner.
-- 15 dilli constraint mevcut `hi` satirlariyla eklenemez; once silinir (veri kaybi bilincli).

DROP FUNCTION IF EXISTS set_user_languages(uuid, text[]);

DELETE FROM user_languages WHERE language_code = 'hi';

ALTER TABLE user_languages
  DROP CONSTRAINT IF EXISTS user_languages_language_code_check;

ALTER TABLE user_languages
  ADD CONSTRAINT user_languages_language_code_check
  CHECK (language_code = ANY (ARRAY[
    'tr', 'en', 'de', 'fr', 'es', 'ar', 'ru',
    'pt', 'it', 'ja', 'ko', 'zh', 'nl', 'pl', 'sv'
  ]));
