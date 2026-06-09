-- Weekly competition table for timed competitive problem-solving sessions

create table if not exists weekly_competitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  problem_slugs text[] not null default '{}',
  problems jsonb not null default '[]',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  score integer,
  max_score integer not null default 0,
  duration_seconds integer,
  created_at timestamptz not null default now()
);

alter table weekly_competitions enable row level security;

create policy "users_own_competitions" on weekly_competitions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index weekly_competitions_user_id_idx on weekly_competitions (user_id, created_at desc);
