-- 042 rollback — ORACLE/HALF sonuc kolonlarini kaldirir.
--
-- SIRA: ONCE sunucu onceki surume alinmali, SONRA bu dosya. Aksi halde `getActiveSession`
-- acik kolon listesinde (current_q_eliminated, current_q_oracle) oldugu icin TUM quiz
-- istekleri SESSION_NOT_FOUND doner; chat tarafi `select("*")` kullandigindan ayakta
-- kalir ama guc sonucu yazimi hata loglar.

ALTER TABLE chat_questions
  DROP COLUMN IF EXISTS eliminated_options,
  DROP COLUMN IF EXISTS oracle_suggested_option;

ALTER TABLE quiz_sessions
  DROP COLUMN IF EXISTS current_q_eliminated,
  DROP COLUMN IF EXISTS current_q_oracle;
