-- Research paper recommendations (level-aligned).
--
-- A lightweight discovery layer on top of the learner's concept knowledge: the
-- recommender turns what the user has actually learned (aiml_concepts with
-- card_status seeded/learned + FSRS recall) into real arXiv papers they can
-- understand right now, each with an AI alignment rationale and an informational
-- list of prerequisite "gaps" to brush up on first.
--
-- This intentionally does NOT resurrect the removed paper-ingestion feature
-- (papers/paper_chunks). It is a distinct, self-contained reading list whose
-- per-paper status (suggested/saved/read/dismissed) survives regeneration via an
-- upsert keyed on (user_id, arxiv_id).

create table if not exists public.paper_recommendations (
  id                  uuid default uuid_generate_v4() primary key,
  user_id             uuid references public.users on delete cascade not null,

  -- arXiv-sourced paper metadata
  arxiv_id            text not null,                 -- e.g. '1706.03762v7'
  title               text not null,
  authors             text[] not null default '{}',
  abstract            text,
  categories          text[] not null default '{}',  -- arXiv categories e.g. {cs.CL, cs.LG}
  published_at        timestamp with time zone,
  abs_url             text,                          -- html landing page
  pdf_url             text,

  -- AI ranking / alignment to this user's learning level
  relevance_score     double precision,              -- 0..1, LLM ranking
  alignment_rationale text,                          -- why it fits THIS user's level
  readiness           text check (readiness in ('ready', 'stretch')),
  reading_order       integer,                       -- suggested sequence within a batch
  matched_concept_ids uuid[] not null default '{}',  -- learned concepts that support it
  matched_concept_titles text[] not null default '{}', -- title snapshot, index-aligned with ids (for display)
  gap_concepts        jsonb not null default '[]',   -- [{ title, reading_suggestion }] (informational)

  -- reading-list lifecycle (preserved across regeneration)
  status              text not null default 'suggested'
                        check (status in ('suggested', 'saved', 'read', 'dismissed')),

  created_at          timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at          timestamp with time zone not null default timezone('utc'::text, now()),

  unique (user_id, arxiv_id)
);

-- RLS — one per-user "manage own" policy (matches concept_roadmaps / feynman_sessions).
alter table public.paper_recommendations enable row level security;
create policy "Users manage own paper recommendations"
  on public.paper_recommendations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Indexes: list by status, and recency for the reading list.
create index paper_recommendations_user_status_idx
  on public.paper_recommendations (user_id, status);
create index paper_recommendations_user_created_idx
  on public.paper_recommendations (user_id, created_at desc);
