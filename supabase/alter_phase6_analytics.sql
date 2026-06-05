-- Phase 6 Analytics — manual table alterations for Supabase SQL Editor
-- Safe to re-run: uses IF NOT EXISTS / guards on constraints.
--
-- Run in: Supabase Dashboard → SQL → New query → paste → Run

-- 1. AIML concept prerequisites (for knowledge graph on /analytics)
alter table public.aiml_concepts
  add column if not exists prerequisites uuid[] default '{}';

comment on column public.aiml_concepts.prerequisites is
  'UUIDs of prerequisite aiml_concepts; used for dependency graph visualization';

-- 2. Review confidence (for calibration chart on /analytics)
alter table public.reviews
  add column if not exists confidence_predicted integer;

-- Add check constraint only if missing (ADD COLUMN inline check is skipped when column exists)
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reviews_confidence_predicted_check'
      and conrelid = 'public.reviews'::regclass
  ) then
    alter table public.reviews
      add constraint reviews_confidence_predicted_check
      check (confidence_predicted is null or (confidence_predicted between 1 and 5));
  end if;
end $$;

comment on column public.reviews.confidence_predicted is
  'User self-rated confidence (1-5) before revealing answer; powers calibration analytics';

-- Optional: verify columns exist
select
  table_name,
  column_name,
  data_type,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('aiml_concepts', 'reviews')
  and column_name in ('prerequisites', 'confidence_predicted')
order by table_name, column_name;
