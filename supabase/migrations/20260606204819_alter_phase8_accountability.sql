-- Phase 8 Accountability Engine — manual table alterations for Supabase SQL Editor
-- Safe to re-run: uses IF NOT EXISTS / guarded constraints.

-- 1. Users: streak tracking + settings
alter table public.users
  add column if not exists streak_last_date date;

alter table public.users
  add column if not exists grace_days_remaining integer default 1;

alter table public.users
  add column if not exists settings jsonb default '{}';

comment on column public.users.streak_last_date is
  'Last calendar date the user completed a study activity (UTC date)';

comment on column public.users.grace_days_remaining is
  'Grace days left this ISO week to preserve streak after a missed day';

comment on column public.users.settings is
  'User preferences: weekly_goal_minutes, week_start_date, weak_area_focus, concept_ratings';

-- 2. Study sessions
create table if not exists public.study_sessions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users on delete cascade not null,
  started_at timestamp with time zone not null default timezone('utc'::text, now()),
  ended_at timestamp with time zone,
  session_type text not null check (
    session_type in ('srs_review', 'dsa_practice', 'aiml_study', 'feynman', 'mixed')
  ),
  planned_minutes integer,
  actual_minutes integer,
  cards_reviewed integer default 0,
  problems_logged integer default 0,
  energy_level integer check (energy_level is null or (energy_level between 1 and 5)),
  mood_end integer check (mood_end is null or (mood_end between 1 and 5)),
  notes text,
  topics_covered text[],
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.study_sessions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'study_sessions'
      and policyname = 'Users can manage own sessions'
  ) then
    create policy "Users can manage own sessions"
      on public.study_sessions for all
      using (auth.uid() = user_id);
  end if;
end $$;

create index if not exists study_sessions_user_started_idx
  on public.study_sessions (user_id, started_at desc);

-- Optional: verify
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'users' and column_name in ('streak_last_date', 'grace_days_remaining', 'settings'))
    or table_name = 'study_sessions'
  )
order by table_name, column_name;
