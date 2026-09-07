-- 049 rollback
drop function if exists public.web_quiz_record_attempt(uuid, integer, integer, jsonb);
alter table public.web_quizzes drop column if exists is_active;
grant select, insert, update, delete on table public.web_quizzes to anon, authenticated;
grant select, insert, update, delete on table public.web_quiz_attempts to anon, authenticated;
