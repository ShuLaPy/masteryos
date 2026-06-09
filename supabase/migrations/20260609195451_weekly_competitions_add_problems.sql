-- Add missing columns to weekly_competitions if the table was created without them

alter table weekly_competitions
  add column if not exists problems jsonb not null default '[]';

alter table weekly_competitions
  add column if not exists problem_slugs text[] not null default '{}';