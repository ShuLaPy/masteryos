-- MasteryOS Database Schema (PostgreSQL for Supabase)

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-----------------------------------------
-- 1. Users Profile Table
-----------------------------------------
create table public.users (
  id uuid references auth.users on delete cascade not null primary key,
  email text not null,
  display_name text,
  streak_count integer default 0,
  daily_goal_minutes integer default 60,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS
alter table public.users enable row level security;
create policy "Users can view own profile" on public.users for select using (auth.uid() = id);
create policy "Users can update own profile" on public.users for update using (auth.uid() = id);
create policy "Users can insert own profile" on public.users for insert with check (auth.uid() = id);

-----------------------------------------
-- 2. SRS Cards (ts-fsrs format)
-----------------------------------------
create table public.srs_cards (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users on delete cascade not null,
  card_type text not null, -- 'concept', 'pattern', 'feynman'
  front text not null,
  back text not null,
  source_type text not null, -- 'aiml_concept', 'dsa_problem'
  source_id uuid not null, -- ID of the concept or problem

  -- FSRS v5 fields
  due timestamp with time zone not null,
  stability double precision not null,
  difficulty double precision not null,
  elapsed_days integer not null,
  scheduled_days integer not null,
  reps integer not null,
  lapses integer not null,
  state text not null, -- 'new', 'learning', 'review', 'relearning'
  last_review timestamp with time zone,

  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS
alter table public.srs_cards enable row level security;
create policy "Users can manage own cards" on public.srs_cards for all using (auth.uid() = user_id);

-----------------------------------------
-- 3. Review Logs (Immutable)
-----------------------------------------
create table public.reviews (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users on delete cascade not null,
  card_id uuid references public.srs_cards on delete cascade not null,
  rating integer not null, -- 1(Again), 2(Hard), 3(Good), 4(Easy)
  duration_seconds integer not null,
  stability_before double precision not null,
  stability_after double precision not null,
  retrievability_at_review double precision not null,
  scheduled_days_after integer not null,
  confidence_predicted integer check (confidence_predicted is null or (confidence_predicted between 1 and 5)),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS
alter table public.reviews enable row level security;
create policy "Users can manage own reviews" on public.reviews for all using (auth.uid() = user_id);

-----------------------------------------
-- 4. AIML Concepts
-----------------------------------------
create table public.aiml_concepts (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users on delete cascade not null,
  title text not null,
  week_number integer,
  concept_type text, -- 'theory', 'math', 'implementation', etc.
  notes text,
  tags text[],
  source text,
  mastery_score double precision default 0, -- 0.0 to 1.0 (from Feynman eval)
  prerequisites uuid[] default '{}',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS
alter table public.aiml_concepts enable row level security;
create policy "Users can manage own concepts" on public.aiml_concepts for all using (auth.uid() = user_id);

-----------------------------------------
-- 5. DSA Problems
-----------------------------------------
create table public.dsa_problems (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users on delete cascade not null,
  title text not null,
  url text,
  difficulty text, -- 'easy', 'medium', 'hard'
  patterns text[],
  approach_notes text,
  time_taken_minutes integer,
  confidence integer, -- 1 to 5
  source text,
  solved_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS
alter table public.dsa_problems enable row level security;
create policy "Users can manage own problems" on public.dsa_problems for all using (auth.uid() = user_id);

-----------------------------------------
-- 6. Daily Plans (AI Mentor Cache)
-----------------------------------------
create table public.daily_plans (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users on delete cascade not null,
  plan_date date not null,
  mentor_message text,
  generated_plan jsonb,
  srs_due_count integer,
  completion_pct double precision default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(user_id, plan_date)
);

-- RLS
alter table public.daily_plans enable row level security;
create policy "Users can manage own plans" on public.daily_plans for all using (auth.uid() = user_id);

-----------------------------------------
-- 7. Supabase Auth Trigger
-----------------------------------------
-- Automatically create a user profile when someone signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, display_name)
  values (
    new.id, 
    new.email, 
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
