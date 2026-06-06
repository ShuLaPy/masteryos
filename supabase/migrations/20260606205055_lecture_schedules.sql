-- lecture_schedules: stores the 32-week lecture plan and per-lecture AI context.
-- extracted_concept_ids and notes are v2 additions (Bridge & Runway spec §9).
create table public.lecture_schedules (
  id                      uuid          default uuid_generate_v4() primary key,
  user_id                 uuid          references public.users on delete cascade not null,
  week_number             integer       not null check (week_number between 1 and 99),
  title                   text          not null check (char_length(title) between 1 and 200),
  scheduled_date          date          not null,
  prerequisite_concept_ids uuid[]       default '{}',
  extracted_concept_ids   uuid[]        default '{}',
  notes                   text          default null,
  is_attended             boolean       default false,
  bridge_cache            jsonb         default null,
  bridge_cache_key        text          default null,
  created_at              timestamptz   default now() not null,
  updated_at              timestamptz   default now() not null
);

alter table public.lecture_schedules enable row level security;

create policy "Users manage own lecture schedule"
  on public.lecture_schedules for all
  using (auth.uid() = user_id);

create index lecture_schedules_user_date_idx
  on public.lecture_schedules (user_id, scheduled_date asc, week_number asc);

-- centrality: optional cached transitive fan-out score for the concept graph.
-- Structural value — does NOT violate the "no separate retrievability column" rule.
-- Recomputed on graph mutation and stored here to avoid per-plan recomputation.
alter table public.aiml_concepts
  add column if not exists centrality numeric default null;
