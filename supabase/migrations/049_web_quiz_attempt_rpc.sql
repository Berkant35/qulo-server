-- 049: web testi — atomik oynanış kaydı + moderasyon kolonu + derinlemesine yetki
-- (review bulguları: plays read-modify-write yarışı, takedown kolonu yok, anon grant)

alter table public.web_quizzes
  add column if not exists is_active boolean not null default true;

-- Oynanış satırı ve sayaç aynı transaction'da; eşzamanlı iki oynanışta biri kaybolmaz.
create or replace function public.web_quiz_record_attempt(
  p_quiz_id uuid,
  p_score integer,
  p_total integer,
  p_answers jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.web_quiz_attempts (quiz_id, score, total, answers)
  values (p_quiz_id, p_score, p_total, p_answers);

  update public.web_quizzes
  set plays = plays + 1
  where id = p_quiz_id;
end;
$$;

revoke all on function public.web_quiz_record_attempt(uuid, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.web_quiz_record_attempt(uuid, integer, integer, jsonb) to service_role;

-- RLS zaten policy'siz; anon/authenticated'e tablo yetkisi de kalmasın.
revoke all on table public.web_quizzes from anon, authenticated;
revoke all on table public.web_quiz_attempts from anon, authenticated;
