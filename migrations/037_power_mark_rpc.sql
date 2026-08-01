-- 037_power_mark_rpc.sql
-- Faz 2 / 2.1c duzeltmesi — guc isaretlemesini TEK SQL IFADESINDE atomik yap.
--
-- Migration 036 sonrasi iki sorun cikti:
--
-- (1) TIP UYUSMAZLIGI: `chat_questions.powers_used` JSONB (migration 019:16),
--     `quiz_sessions.current_q_powers` ise text[]. Ayni PostgREST filtresi
--     (`.not(col, "cs", "{POWER}")`) ikisinde birden calismaz — JSONB kolonda
--     `{POWER}` gecersiz JSON'dur ve her chat guc kullanimi 500 doner.
--
-- (2) LOST UPDATE: `.update({ col: [...stale, power] })` deseninde yeni deger
--     istek basindaki snapshot'tan hesaplaniyor. Iki es zamanli FARKLI guc
--     (HALF + HINT) icin `.not(cs)` kosulu ikisini de gecirir, ikinci yazma
--     birincinin isaretini siler → kullanici o gucu ikinci kez ODER.
--
-- Cozum: append islemi WHERE ile ayni ifadede, satirin GUNCEL degeri uzerinden
-- yapilir. Postgres es zamanli UPDATE'i satir kilidiyle seri hale getirir ve
-- WHERE'i yeni satir surumuyle yeniden degerlendirir (EvalPlanQual), dolayisiyla
-- hem dedupe hem kayipsizlik garanti edilir.
--
-- Donus: true = isaretlendi (ucretlendirilebilir), false = zaten kullanilmis.

CREATE OR REPLACE FUNCTION chat_question_mark_power(p_question_id uuid, p_power text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  affected int;
BEGIN
  UPDATE chat_questions
     SET powers_used = COALESCE(powers_used, '[]'::jsonb) || to_jsonb(p_power)
   WHERE id = p_question_id
     AND NOT (COALESCE(powers_used, '[]'::jsonb) @> to_jsonb(p_power));
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$$;

CREATE OR REPLACE FUNCTION chat_question_unmark_power(p_question_id uuid, p_power text)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE chat_questions
     SET powers_used = COALESCE(powers_used, '[]'::jsonb) - p_power
   WHERE id = p_question_id;
$$;

CREATE OR REPLACE FUNCTION quiz_session_mark_power(p_session_id uuid, p_power text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  affected int;
BEGIN
  UPDATE quiz_sessions
     SET current_q_powers = array_append(COALESCE(current_q_powers, '{}'), p_power)
   WHERE id = p_session_id
     AND NOT (COALESCE(current_q_powers, '{}') @> ARRAY[p_power]);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$$;

CREATE OR REPLACE FUNCTION quiz_session_unmark_power(p_session_id uuid, p_power text)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE quiz_sessions
     SET current_q_powers = array_remove(COALESCE(current_q_powers, '{}'), p_power)
   WHERE id = p_session_id;
$$;
