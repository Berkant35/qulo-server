-- 044 rollback — users.locale constraint'ini 15 dile dondurur.
-- 15 dilli constraint mevcut `hi` satirlariyla eklenemez; once `en`'e cekilir (bilincli).

UPDATE users SET locale = 'en' WHERE locale = 'hi';

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_locale_check;

ALTER TABLE users
  ADD CONSTRAINT users_locale_check
  CHECK (locale = ANY (ARRAY[
    'tr', 'en', 'de', 'fr', 'es', 'ar', 'ru',
    'pt', 'it', 'ja', 'ko', 'zh', 'nl', 'pl', 'sv'
  ]));
