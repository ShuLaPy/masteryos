-- Phase 6: Analytics Dashboard schema additions

alter table public.aiml_concepts
  add column if not exists prerequisites uuid[] default '{}';

alter table public.reviews
  add column if not exists confidence_predicted integer
  check (confidence_predicted is null or (confidence_predicted between 1 and 5));
