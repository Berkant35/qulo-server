-- 055_questions_locale_check_hi.sql
-- 043/044'un ucuncusu: questions.locale CHECK'i repo'da 011 (15 dil, `hi` yok) haliyle
-- kalmisti. Canli semada constraint zaten 16 dil (2026-09-13'te pg_constraint ile
-- dogrulandi — drift). Bu dosya repo'yu canliyla hizalar; idempotent.
-- Liste = SUPPORTED_LOCALES (constants/locales.ts); parity testi bu dosyayi okur
-- (tests/services/user-language.service.test.ts). Yeni dil eklerken 043/044/055 birlikte.

BEGIN;

ALTER TABLE questions
  DROP CONSTRAINT IF EXISTS questions_locale_check;

ALTER TABLE questions
  ADD CONSTRAINT questions_locale_check
  CHECK (locale = ANY (ARRAY[
    'tr', 'en', 'de', 'fr', 'es', 'ar', 'ru',
    'pt', 'it', 'ja', 'ko', 'zh', 'nl', 'pl', 'sv', 'hi'
  ]));

COMMIT;
