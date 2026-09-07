-- 048: "Beni çözebilir misin?" web testi (quloapp.com/q)
-- Hesapsız, paylaşılabilir 5 soruluk test. Soru metni ai_question_bank'tan dondurulur.
-- RLS açık, policy yok: yalnızca service_role (qulo-server) okur/yazar; anon yolu kapalı.

create table if not exists public.web_quizzes (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  locale          text not null,
  nickname        text not null,
  questions       jsonb not null,
  plays           integer not null default 0,
  creator_ip_hash text,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '30 days')
);

create index if not exists web_quizzes_expires_at_idx on public.web_quizzes (expires_at);

create table if not exists public.web_quiz_attempts (
  id         uuid primary key default gen_random_uuid(),
  quiz_id    uuid not null references public.web_quizzes (id) on delete cascade,
  score      integer not null,
  total      integer not null,
  answers    jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists web_quiz_attempts_quiz_id_idx on public.web_quiz_attempts (quiz_id);

alter table public.web_quizzes enable row level security;
alter table public.web_quiz_attempts enable row level security;

comment on table public.web_quizzes is 'Hesapsiz paylasilabilir web testi (quloapp.com/q/<slug>); 30 gun TTL';
comment on table public.web_quiz_attempts is 'Web testi oynanislari — skor istatistigi ve veri-PR icin';
