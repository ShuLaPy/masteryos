alter table public.aiml_concepts
  add column if not exists notes text default null,
  add column if not exists card_status text default 'none'
    check (card_status in ('none', 'seeded', 'learned')),
  add column if not exists card_status_updated_at timestamptz default null;
