create table public.problem_bank (
  id uuid default uuid_generate_v4() primary key,
  slug text not null unique,
  title text not null,
  difficulty text not null check (difficulty in ('easy','medium','hard')),
  patterns text[] not null default '{}',
  leetcode_url text not null,
  acceptance_rate numeric default null
);

alter table public.problem_bank enable row level security;

create policy "Anyone authenticated can read problem bank"
  on public.problem_bank for select using (auth.role() = 'authenticated');

create index problem_bank_patterns_idx on public.problem_bank using gin (patterns);
create index problem_bank_difficulty_idx on public.problem_bank (difficulty);
