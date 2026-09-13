-- 055_questions_locale_check_hi_rollback.sql
-- 011 listesine (15 dil) doner. `hi` sorusu varsa ADD CONSTRAINT basarisiz olur — o zaman
-- geri alma anlamsizdir, raporla.
BEGIN;

ALTER TABLE questions
  DROP CONSTRAINT IF EXISTS questions_locale_check;

ALTER TABLE questions
  ADD CONSTRAINT questions_locale_check
  CHECK (locale IN ('tr','en','de','fr','es','ar','ru','pt','it','ja','ko','zh','nl','pl','sv'));

COMMIT;
