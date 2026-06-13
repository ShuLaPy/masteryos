-- Feynman session persistence (roadmap Phase 1a hardening).
-- CLAUDE.md documents feynman_sessions as storing full conversation history, but
-- the table was never created and the /api/ai/feynman PUT handler discarded the
-- conversation. This creates the table so teaching sessions are durable (and so
-- Phase 3's paper "explain the math" dialogues have a proven persistence pattern
-- to mirror via paper_dialogues).
create table if not exists public.feynman_sessions (
  id              uuid default uuid_generate_v4() primary key,
  user_id         uuid references public.users on delete cascade not null,
  concept_id      uuid references public.aiml_concepts on delete set null,
  messages        jsonb not null default '[]',   -- [{ role, content }] full transcript
  evaluation      jsonb,                          -- { mastery_score, strong_points,
                                                  --   weak_points, follow_up_cards, dimensions? }
  mastery_score   double precision,               -- denormalized for fast listing
  cards_generated integer not null default 0,
  created_at      timestamp with time zone not null default timezone('utc'::text, now())
);

-- RLS
alter table public.feynman_sessions enable row level security;
create policy "Users manage own feynman sessions"
  on public.feynman_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index feynman_sessions_user_concept_idx
  on public.feynman_sessions (user_id, concept_id, created_at desc);
