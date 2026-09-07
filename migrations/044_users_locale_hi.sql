-- 044_users_locale_hi.sql
-- 043'un ikizi: `users.locale` CHECK constraint'i (011_language_system.sql) 15 dilde kalmisti,
-- sunucu SUPPORTED_LOCALES (constants/locales.ts) ve mobil 16 dil destekliyor.
-- Hindi cihazdan gelen PATCH /me { locale: 'hi' } validator'dan gecip DB'de patliyordu (500);
-- push bildirimi dili de `users.locale`'den okundugu icin (notification.service.ts) Hindi
-- kullanici hicbir zaman kendi dilinde push alamiyordu.
--
-- Constraint listesi = SUPPORTED_LOCALES; parity testi bu dosyayi okur
-- (tests/services/user-language.service.test.ts). Yeni dil eklerken ikisini birlikte guncelle.

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_locale_check;

ALTER TABLE users
  ADD CONSTRAINT users_locale_check
  CHECK (locale = ANY (ARRAY[
    'tr', 'en', 'de', 'fr', 'es', 'ar', 'ru',
    'pt', 'it', 'ja', 'ko', 'zh', 'nl', 'pl', 'sv', 'hi'
  ]));
