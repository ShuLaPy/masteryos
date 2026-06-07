-- Enrich problem_bank with video + company data from the zubyj dataset.
alter table public.problem_bank
  add column if not exists company_tags text[] default '{}',
  add column if not exists video_solutions jsonb default '[]',
  add column if not exists elo_rating integer default null;

-- GIN index so "problems asked by Google" queries stay fast.
create index if not exists problem_bank_companies_idx
  on public.problem_bank using gin (company_tags);

-- Cache the AI explanation per solved problem.
-- Lives on dsa_problems (solved problems), not problem_bank (the catalog).
alter table public.dsa_problems
  add column if not exists ai_explanation text default null,
  add column if not exists ai_explanation_generated_at timestamptz default null,
  add column if not exists ai_explanation_model text default null;
