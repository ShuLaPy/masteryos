-- Add 'seeding' to the aiml_concepts.card_status CHECK (roadmap Phase 1a).
-- The cold-start seeding mutex (claimConceptsForSeeding) atomically flips a
-- concept to 'seeding' as a claim before generating primer cards; the original
-- CHECK only allowed 'none'/'seeded'/'learned', so the claim UPDATE would fail.
alter table public.aiml_concepts
  drop constraint if exists aiml_concepts_card_status_check;

alter table public.aiml_concepts
  add constraint aiml_concepts_card_status_check
  check (card_status in ('none', 'seeding', 'seeded', 'learned'));
