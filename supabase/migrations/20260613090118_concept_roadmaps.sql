-- Dynamic Learning Path Generator for AI/ML concepts.
--
-- When a concept is created, an AI-generated, dependency-aware syllabus (an
-- INDEX of topics to study to reach mastery — never the educational content
-- itself) is produced and rendered on the concept page. The learner tracks
-- manual progress through it; completion % is rolled up from leaf items at read
-- time (no cached column, so nothing can drift).
--
-- Two tables (relational, not a jsonb blob) because each topic carries its own
-- progress, notes, resources, difficulty, estimate, and dependency edges.

-- One roadmap per (user, concept). Owns the generation lifecycle, mirroring the
-- aiml_concepts.card_status state machine (see lib/concept-seeder.ts): the
-- generator atomically flips 'pending'/'failed'/stale-'generating' -> 'generating'
-- as a claim so two callers (create-route fire-and-forget + page-level POST)
-- never generate the same roadmap twice.
create table if not exists public.concept_roadmaps (
  id                 uuid default uuid_generate_v4() primary key,
  user_id            uuid references public.users on delete cascade not null,
  concept_id         uuid references public.aiml_concepts on delete cascade not null,
  status             text not null default 'pending'
                       check (status in ('pending', 'generating', 'ready', 'failed')),
  status_updated_at  timestamp with time zone not null default timezone('utc'::text, now()),
  version            integer not null default 1,   -- bumped on regeneration (future expansion)
  model              text,                          -- which model produced the current items
  error              text,                          -- last failure reason, surfaced for retry UI
  created_at         timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at         timestamp with time zone not null default timezone('utc'::text, now()),
  unique (user_id, concept_id)
);

-- The hierarchy. Phases are simply depth-0 rows (parent_item_id null) so the
-- tree is uniform: phase (0) -> topic (1) -> subtopic (2).
create table if not exists public.roadmap_items (
  id                 uuid default uuid_generate_v4() primary key,
  user_id            uuid references public.users on delete cascade not null,
  roadmap_id         uuid references public.concept_roadmaps on delete cascade not null,
  concept_id         uuid not null,                 -- denormalized for direct querying
  parent_item_id     uuid references public.roadmap_items on delete cascade,
  depth              integer not null default 0,    -- 0=phase, 1=topic, 2=subtopic
  sort_order         integer not null default 0,
  title              text not null,
  description        text,                          -- one-line "what this covers" — index only
  difficulty         text check (difficulty in ('foundational', 'intermediate', 'advanced', 'expert')),
  estimated_minutes  integer,
  status             text not null default 'not_started'
                       check (status in ('not_started', 'in_progress', 'completed')),
  notes              text,                          -- per-item user notes
  resources          jsonb not null default '[]',   -- [{ type, title, url }] — empty on generate
  depends_on         uuid[] not null default '{}',  -- edges -> other roadmap_items.id
  completed_at       timestamp with time zone,
  created_at         timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at         timestamp with time zone not null default timezone('utc'::text, now())
);

-- RLS — one per-user "manage own" policy per table (matches feynman_sessions).
alter table public.concept_roadmaps enable row level security;
create policy "Users manage own concept roadmaps"
  on public.concept_roadmaps for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.roadmap_items enable row level security;
create policy "Users manage own roadmap items"
  on public.roadmap_items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Indexes: ordered tree fetch, and lookup by concept.
create index roadmap_items_tree_idx
  on public.roadmap_items (roadmap_id, parent_item_id, sort_order);
create index roadmap_items_user_concept_idx
  on public.roadmap_items (user_id, concept_id);
