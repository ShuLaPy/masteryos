-- Weekly AI Mock-Interview ("Interview Mode")
--
-- One row per interview session. The question_plan is computed once (server-side)
-- at session start and is authoritative for the whole session; grades are an
-- append-only log of applied per-slot grades; transcript is the full chat history
-- persisted on finish. Feedback is "shadow-score only" — grading EMA-blends
-- aiml_concepts.mastery_score and seeds follow-up srs_cards, but never writes a
-- reviews row, moves srs_cards.due, or mutates pattern_mastery.

create table public.interview_sessions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users on delete cascade not null,
  status text not null default 'active' check (status in ('active', 'complete', 'abandoned')),
  question_plan jsonb not null,              -- ordered slot array, computed once at start
  grades jsonb not null default '[]',        -- append-only applied per-slot grades
  transcript jsonb not null default '[]',    -- full {role,content}[] history, written on finish
  current_slot integer not null default 0,   -- server-authoritative ramp position
  overall_score numeric,                     -- 0..1 readiness, set on finish
  week_start_date date not null,             -- getWeekStartDate() at creation; one-per-week lookup
  started_at timestamp with time zone not null default timezone('utc'::text, now()),
  ended_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

-- RLS
alter table public.interview_sessions enable row level security;
create policy "Users manage own interview sessions"
  on public.interview_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index interview_sessions_user_week_idx
  on public.interview_sessions (user_id, week_start_date);
