-- 7.1 — log pattern detection drills (separate from solve attempts)
create table public.pattern_drill_attempts (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users on delete cascade not null,
  problem_slug text not null,
  guessed_patterns text[] not null default '{}',
  correct_patterns text[] not null default '{}',
  is_correct boolean not null,
  created_at timestamptz default now() not null
);
alter table public.pattern_drill_attempts enable row level security;
create policy "Users manage own drills"
  on public.pattern_drill_attempts for all using (auth.uid() = user_id);

-- 7.6 — store competition results for the weekly score trend
create table public.weekly_competitions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users on delete cascade not null,
  problem_slugs text[] not null default '{}',
  started_at timestamptz not null default now(),
  completed_at timestamptz default null,
  score numeric default 0,
  max_score numeric default 0,
  duration_seconds integer default null,
  created_at timestamptz default now() not null
);
alter table public.weekly_competitions enable row level security;
create policy "Users manage own competitions"
  on public.weekly_competitions for all using (auth.uid() = user_id);
