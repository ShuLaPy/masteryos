-- Derivation/math-mastery cards (roadmap Phase 1b, goal 4).
--   srs_cards.payload     — structured body for non-prose card types. For
--                           card_type='derivation' it holds the step-by-step
--                           proof the student must reproduce:
--                           { goal_latex: text,
--                             steps: [{ latex: text, explanation: text }],
--                             source_section: text|null }
--                           Prose cards (card_type='concept'|'pattern'|…) leave
--                           it null and continue to use front/back unchanged.
--   aiml_concepts.derivations — cached list of named derivations generated for a
--                           concept so the enrich UI can show what already exists
--                           and avoid regenerating duplicates:
--                           [{ title: text, card_id: uuid, generated_at: text }]
--
-- card_type is unconstrained text (initial_schema.sql), so 'derivation' needs no
-- enum/constraint change; the entire FSRS review pipeline (app/api/review,
-- card-estimator, planning-engine zones, analytics) operates on srs_cards rows
-- and treats derivation cards identically for scheduling.
alter table public.srs_cards
  add column if not exists payload jsonb default null;

alter table public.aiml_concepts
  add column if not exists derivations jsonb default null;
