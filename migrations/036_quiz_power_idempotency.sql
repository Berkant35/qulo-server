-- 036_quiz_power_idempotency.sql
-- Faz 2 / 2.1c — cift-ucretlendirme korumasi (quiz ayagi)
--
-- Envanter kapisi kaldirilinca (guc butonlari artik dogrudan mor elmastan dusuyor)
-- ayni guce tekrar tekrar basip tekrar tekrar ucret alinmasini engelleyecek bir kayit
-- gerekiyor. Chat'te bu is `chat_questions.powers_used` dizisiyle zaten yapilabiliyor;
-- quiz'de non-terminating gucler (ORACLE/HALF/HINT/TIME_EXTEND) `quiz_answers`'a satir
-- yazmadigi icin hicbir kayit yoktu.
--
-- Bu kolon SADECE o an acik olan sorunun guclerini tutar; `incrementCurrentQ` her soru
-- gecisinde sifirlar (hem cevap hem rescue yolu oradan geciyor).

ALTER TABLE quiz_sessions
  ADD COLUMN IF NOT EXISTS current_q_powers text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN quiz_sessions.current_q_powers IS
  'Su anki soruda kullanilmis guc adlari. Soru gecisinde sifirlanir. Ayni gucun ikinci kez ucretlendirilmesini engeller.';
