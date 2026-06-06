<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Bridge & Runway — Claude Code Build Guide

## Feature context

We are implementing the "Bridge & Runway" prerequisite-aware scheduling feature.
The full specification is in `docs/bridge-runway-spec.md` (copy it there).

Core idea: partition the daily study plan into three zones —
- Immediate Recall (after lecture)
- Prerequisite Runway (before next lecture, priority-scored by importance)
- General SRS (overdue cards not in other zones)

## Spec location
`docs/bridge-runway-spec.md` — read this before implementing any phase.

## Intelligence layer (most important)
Priority formula for ranking prerequisites:
  Urgency    U = 1 − R  (R = min retrievability across concept's cards)
  Relevance  = 0.45·BlastRadius + 0.30·Centrality + 0.25·Proximity
  Priority   = U × (0.15 + 0.85·Relevance)

BlastRadius = fraction of next lecture's concepts that depend on this prereq.
Centrality  = normalized transitive fan-out in aiml_concepts prerequisite graph.
Proximity   = clamp((14 − days_until_lecture) / 14, 0, 1)

These are computed in `lib/concept-graph.ts` (to be created).

## New files to create

lib/concept-graph.ts          — computeCentrality, computeBlastRadius
lib/planning-engine.ts        — all zone logic, priority scoring, capacity fill
lib/card-estimator.ts         — estimateCardMinutes based on FSRS state
app/api/lectures/route.ts     — GET + POST lecture schedule
app/api/lectures/[id]/route.ts              — GET + PATCH + DELETE
app/api/lectures/[id]/attend/route.ts       — mark attended + AI ingestion
app/api/lectures/bridge/route.ts            — AI Bridge synthesis
app/api/lectures/settings/route.ts          — weakness threshold + zone prefs
app/api/plans/generate/route.ts             — on-demand plan generation
app/api/cron/daily-plans/route.ts           — cron for all-user generation
app/api/metrics/readiness/route.ts          — per-lecture readiness tracking
app/(dashboard)/schedule/page.tsx           — lecture schedule manager
app/(dashboard)/schedule/prep/page.tsx      — pre-class prep view
app/(dashboard)/schedule/bridge/page.tsx    — bridge view
components/app/ZonePlanView.tsx
components/app/PreClassPrepCard.tsx
components/app/BridgeDocument.tsx
components/app/LectureScheduleForm.tsx

## Files to modify

app/(dashboard)/page.tsx     — add zone plan section and Runway widget
app/globals.css              — no changes expected
types/database.ts            — regenerate after migration

## New Supabase migration

supabase/migrations/<timestamp>_lecture_schedules.sql

## Key constraints (always enforce)

- No AI/OpenAI calls from client components — server API routes only
- No raw SQL — Supabase JS client only
- Use lib/supabase/server.ts in API routes, lib/supabase/client.ts in client components
- lib/supabase/admin.ts only for privileged ops (cron, concept dedup)
- All async helpers return { data, error } tuples
- TypeScript strict — no `any`
- Use existing lib/fsrs.ts getRetrievability and getRetentionColor — never reimplement FSRS
- All tables have RLS; queries must use authenticated client
- Dark mode only — use CSS vars from globals.css (see CLAUDE.md design system)
- ANTHROPIC_API_KEY is set but current AI uses OpenAI (gpt-4o) — keep using OpenAI

## Naming conventions (match existing codebase)

- DB columns: snake_case
- TS variables: camelCase
- Components: PascalCase
- API return: { data, error } tuple
- FSRS state in DB: lowercase text ('new', 'learning', 'review', 'relearning')

## Zone allocation math rules (must be exact)

1. Allocate minutes = round(dailyGoalMinutes × pct / 100) per zone
2. Assign rounding remainder to the zone with the largest fractional part
3. All three zones must sum exactly to dailyGoalMinutes
4. If a zone has no eligible items, redistribute its minutes proportionally to the other non-empty zones (same rounding rule)
5. If all zones empty, each gets 0 minutes

## Weakness threshold default = 0.85

Stored in users.settings.weakness_threshold.
Falls back to 0.85 if unset or invalid.

## Timezone resolution

Always resolve "today" via users.settings.timezone (IANA).
Fall back to UTC if timezone is missing or invalid.
Use date-fns-tz or the Intl API — do not roll your own TZ logic.

## Concept dedup on ingestion

When AI extracts concepts from attended lecture:
1. For each extracted concept, query concept_embeddings with cosine similarity > 0.85
2. If match found, link to existing aiml_concepts row (do not duplicate)
3. If no match, create new aiml_concepts row + embedding
4. Write extracted concept IDs to lecture_schedules.extracted_concept_ids
5. Store raw material text in lecture_schedules.notes

## Cold-start remediation

Unstudied prereqs of next lecture within 7 days → generate primer + 3-5 seed cards
using same AI ingestion pipeline but sourced from concept definition, not uploaded notes.
Place primer task in Prerequisite_Runway_Zone with U=1 (fully unknown = max urgency).

## Bridge cache key (content-aware, not ID-only)

bridge_cache_key = hash(
  most_recent.extracted_concept_ids joined + most_recent.updated_at +
  next.prerequisite_concept_ids joined + prereq concepts' updated_at
)
Invalidate when content changes, not just when IDs change.
