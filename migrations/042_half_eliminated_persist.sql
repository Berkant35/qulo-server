-- 042_half_eliminated_persist.sql
-- ORACLE × HALF havuz bug'i
--
-- ORACLE ile HALF birbirinden habersizdi: sonuclari hicbir yere yazilmiyordu.
--   HALF → ORACLE: ORACLE'in yanlis dali 2/3 olasilikla ELENMIS sikki oneriyordu.
--   ORACLE → HALF: HALF, ORACLE'in yanlis onerisini 2/3 olasilikla eliyordu.
-- Iki sirada da kullanici "ORACLE yanlisti" bilgisini bedavaya ogreniyordu (fiili
-- basari %80-90, tasarlanan %70). Dort kolon iki gucun sonucunu saklar: ORACLE
-- kalan havuzdan secer, HALF ORACLE'in onerisini elemez.
--
-- Chat kolonlari `select("*")` ile istemciye doner (ekran yeniden acilinca hidre edilir).
-- Quiz kolonlari `current_q_powers` (036) ile ayni yasam dongusundedir: `incrementCurrentQ`
-- her soru gecisinde sifirlar; istemciye donmez (quiz restart hidrasyonu kapsam disi).
--
-- `chat_questions.powers_used` JSONB'dir (019); buradaki kolonlar bilerek text[] —
-- quiz kolonlariyla ayni PostgREST semantigi. `cs` filtresi yazarken 037'yi oku.
-- Additive + nullable/default'lu: eski sunucu kodu bu kolonlarla calismaya devam eder.

ALTER TABLE chat_questions
  ADD COLUMN IF NOT EXISTS eliminated_options text[],
  ADD COLUMN IF NOT EXISTS oracle_suggested_option text;

COMMENT ON COLUMN chat_questions.eliminated_options IS
  'HALF gucunun eledigi sik harfleri (A-D). ORACLE bu siklari onermez.';
COMMENT ON COLUMN chat_questions.oracle_suggested_option IS
  'ORACLE gucunun onerdigi sik harfi (A-D). HALF bu sikki elemez.';

ALTER TABLE quiz_sessions
  ADD COLUMN IF NOT EXISTS current_q_eliminated integer[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS current_q_oracle smallint;

COMMENT ON COLUMN quiz_sessions.current_q_eliminated IS
  'Su anki soruda HALF ile elenen cevap indeksleri (1-4). Soru gecisinde sifirlanir. ORACLE bunlari onermez.';
COMMENT ON COLUMN quiz_sessions.current_q_oracle IS
  'Su anki soruda ORACLE''in onerdigi cevap indeksi (1-4). Soru gecisinde sifirlanir. HALF bunu elemez.';
