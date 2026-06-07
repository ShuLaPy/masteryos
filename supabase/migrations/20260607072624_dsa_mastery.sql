-- DSA Mastery — schema deltas (spec §12).
-- NOTE: problem_bank already exists (see 20260607063852_problem_bank.sql) — not recreated here.
-- NOTE: users.settings (jsonb) also carries dsa_daily_goal_minutes and
--       dsa_zone_allocation_preferences — these live in the existing settings jsonb,
--       so no DDL is required for them.

-- Per-pattern skill rating (Glicko-2). One row per (user, pattern).
create table public.pattern_mastery (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users on delete cascade not null,
  pattern text not null,                      -- one of the 25 in lib/constants.ts
  rating numeric not null default 1500,
  rd numeric not null default 350,            -- Glicko deviation (uncertainty)
  volatility numeric not null default 0.06,
  attempts integer not null default 0,
  last_attempt_at timestamptz default null,
  updated_at timestamptz default now() not null,
  unique (user_id, pattern)
);

alter table public.pattern_mastery enable row level security;

create policy "Users manage own pattern mastery"
  on public.pattern_mastery for all using (auth.uid() = user_id);

-- Append-only solve log (the Glicko input; analog of `reviews` but for problems).
create table public.problem_attempts (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users on delete cascade not null,
  problem_id uuid references public.dsa_problems on delete set null,
  patterns text[] not null default '{}',      -- patterns credited this attempt
  difficulty text not null,                    -- easy | medium | hard
  outcome_score numeric not null,              -- 0.0–1.0 mapped score (§4.2)
  time_seconds integer,
  used_hints boolean default false,
  pattern_identified text,                     -- did they classify it correctly?
  created_at timestamptz default now() not null
);

alter table public.problem_attempts enable row level security;

create policy "Users manage own problem attempts"
  on public.problem_attempts for all using (auth.uid() = user_id);

create index problem_attempts_user_pattern_idx
  on public.problem_attempts(user_id, created_at desc);
