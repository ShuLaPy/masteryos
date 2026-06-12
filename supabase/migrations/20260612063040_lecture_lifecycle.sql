-- Lecture lifecycle (Prime → Capture → Reinforce):
--   attended_at        — stable anchor for 24h/72h/7d reinforcement windows
--                        (updated_at mutates on every edit, so it can't anchor them)
--   brain_dump         — free recall typed by the student before opening notes
--   gap_analysis       — AI comparison of brain dump vs lecture material
--                        { analyzed_at, concepts: [{ concept_id, name, status, note }] }
--   pretest            — pre-lecture priming quiz { generated_at, cache_key, questions }
--   pretest_attempt    — student answers + self-grades { taken_at, answers }
alter table public.lecture_schedules
  add column if not exists attended_at      timestamptz default null,
  add column if not exists brain_dump       text        default null,
  add column if not exists brain_dump_at    timestamptz default null,
  add column if not exists gap_analysis     jsonb       default null,
  add column if not exists pretest          jsonb       default null,
  add column if not exists pretest_attempt  jsonb       default null,
  add column if not exists pretest_taken_at timestamptz default null;

-- Reinforcement checkpoints count distinct reviewed cards within a time window.
create index if not exists reviews_user_card_created_idx
  on public.reviews (user_id, card_id, created_at);
