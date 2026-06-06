# MasteryOS — Prerequisite-Aware Scheduling ("Bridge & Runway")
## Consolidated Specification v2

This document merges three inputs into one buildable spec:

- **Kiro requirements** → kept as the correctness contract (validation, RLS, timezone, edge cases).
- **Antigravity plan** → kept as the engineering blueprint (tables, routes, libs, pages).
- **ChatGPT feedback** → its "intelligence layer" idea is adopted, but the formula is corrected and three further gaps are closed.

Where this document changes a numbered acceptance criterion, the change is called out explicitly in **§11 — Changes to the Formal Requirements**.

---

## 1. North Star (the actual intention)

A weekly-lecture learner (32-week IIT AIML course, Saturday lectures) should compound strength week over week. The system must do three jobs and do them in the *right order in the week*:

1. **Runway** — before Saturday, refresh the *prerequisites* the next lecture depends on, weighted by how much they actually matter, so the learner walks in prepared.
2. **Immediate Recall** — right after Saturday, ingest the lecture material via AI, extract concepts, and lock them in against the steepest part of the forgetting curve.
3. **Bridge** — mid-week, an AI synthesis connecting last lecture → next lecture, so the learner sees the structural/mathematical throughline.

The difference between a *scheduler* and a *tutor* is prioritization. The system should not treat all weak prerequisites equally; it should spend the learner's limited daily minutes on the concepts with the highest leverage. That intelligence layer (§4–§6) is the core of this version.

---

## 2. How the three documents relate

| Document | Layer | Strength | What it lacks |
|---|---|---|---|
| Kiro requirements | Contract | Edge cases, RLS, timezone rigor, empty-zone math | All prerequisites ranked only by retrievability |
| Antigravity plan | Blueprint | Tables, routes, libs, pages, bridge cache | Same flat ranking; cache key by IDs only; no concept→lecture link |
| ChatGPT feedback | Critique | Spotted the missing intelligence layer | Formula conflates depth/importance; pure-multiplicative; misses cold-start, card-time, dedup, feedback loop |

Verdict: build on Antigravity's blueprint, keep Kiro's contract verbatim where unchanged, and insert the corrected intelligence layer.

---

## 3. Architecture

```
lecture_schedules ──► Planning Engine ──► daily_plans (zone-partitioned JSONB)
       │                    │
 extracted_concept_ids      ├─ FSRS retrievability        (lib/fsrs.ts, unchanged)
       │                    ├─ Concept graph: centrality + blast radius   (NEW: lib/concept-graph.ts)
       │                    ├─ Priority scoring + capacity fill           (NEW: lib/planning-engine.ts)
       │                    └─ Cold-start remediation for unstudied prereqs (NEW)
       │
       ├─ AI ingestion: extract → dedup → link into graph  (NEW dedup step)
       ├─ Pre-Class Prep View
       ├─ Bridge View (content-aware cache)
       └─ Weekly Readiness dashboard                       (NEW feedback loop)
```

Unchanged principles (from requirements): extend `daily_plans`, reuse `aiml_concepts.prerequisites` and FSRS helpers, FSRS state stays in `srs_cards`, **no separate retrievability column**, follow Supabase RLS conventions.

---

## 4. The Intelligence Layer (priority scoring) — the heart of v2

### 4.1 Why the ChatGPT formula is wrong

ChatGPT proposed `Priority = (1−R) × Proximity × DependencyDepth × Importance`. Two defects:

1. **Depth and Importance are the same signal measured twice.** Both describe "how foundational." Replace with one structural measure (Centrality) plus one lecture-targeted measure (Blast Radius).
2. **Pure multiplication over-suppresses.** A concept you've fully forgotten but whose lecture is 4 weeks out gets multiplied toward zero and never surfaces. Urgency should *gate*, but relevance should be *additive* so a foundational gap always retains a floor.

### 4.2 The corrected model

For each candidate concept, compute:

```
R  = min(getRetrievability(card)) across the concept's Concept_Cards   ∈ [0,1]
U  = 1 − R                                                              (urgency; gates the score)

Centrality  C = normalized transitive fan-out of the concept in the      ∈ [0,1]
                aiml_concepts prerequisite graph (how many downstream
                concepts depend on it). Matrix-mult → high; softmax → low.

BlastRadius B = fraction of the *next lecture's* concepts that depend     ∈ [0,1]
                (directly or transitively) on this prerequisite.
                The lecture-specific "how much does THIS lecture rest on it".

Proximity   P = clamp((W − d) / W, 0, 1), d = days until the lecture       ∈ [0,1]
                this prereq feeds, W = lookahead window (default 14).
                Lecture tomorrow → ~1; ≥W days out → ~0.

Relevance   = w_c·C + w_b·B + w_p·P          (weights sum to 1)
Priority    = U × (ε + (1 − ε)·Relevance)    (ε = 0.15 floor)
```

Default weights (tunable, stored in `users.settings.priority_weights`):

```
w_b = 0.45   (blast radius — most targeted, weighted highest)
w_c = 0.30   (global centrality)
w_p = 0.25   (lecture proximity / pull-forward)
ε   = 0.15
```

### 4.3 Why this is correct

- **Urgency gates.** R ≈ 1 → U ≈ 0 → priority ≈ 0. You never burn minutes on what you remember.
- **Relevance is additive**, so a foundational concept (high C) keeps a meaningful score even when proximity is low — it just won't dominate.
- **Blast Radius is the differentiator inside the Runway zone.** All Runway items feed the same next lecture, so Proximity is constant among them; Centrality and Blast Radius do the ranking work. Proximity matters *across* lectures (pull-forward decisions, §7), not within one.
- **Worked example** (lecture tomorrow, both at R=0.60 → U=0.40):

  | Concept | C | B | P | Relevance | Priority |
  |---|---|---|---|---|---|
  | Matrix Multiplication | 0.90 | 0.80 | 1.0 | 0.84 | 0.336 |
  | Softmax | 0.30 | 0.25 | 1.0 | 0.45 | 0.180 |

  Same retention, very different priority — matrix-mult reviewed first. This is the tutor behavior ChatGPT wanted, computed from data you already have.

### 4.4 Determinism (preserve Req 2.6)

If two concepts tie on Priority: break by retrievability ascending, then by concept id ascending. Ranking stays deterministic.

---

## 5. Capacity-aware zone filling (the real payoff)

Priority scoring is wasted if you only use it to *order* a list. Its value is **selection under a time budget**.

### 5.1 Card-time model (a genuine gap in both docs)

You cannot allocate "20 minutes to Runway" without knowing how long a card takes. Estimate per-card minutes from FSRS state:

```
new / learning card     ≈ 1.5 min
review card             ≈ 0.5 + 0.5·(difficulty/10) min   (≈ 0.5–1.0 min)
cold-start primer task  ≈ 4–6 min (one-time, see §6)
```

Store the estimate on the plan item (`est_minutes`) so the UI can show realistic counts.

### 5.2 Fill algorithm (per zone)

```
1. Gather eligible items for the zone.
2. Score each (Priority, §4) and sort descending.
3. Greedily add items until cumulative est_minutes ≥ zone allocation.
4. Items that don't fit → `deferred[]` (carried to tomorrow, naturally re-ranked).
```

This gives the planner a principled way to **truncate** when there's more to review than time — which neither input handled. Empty-zone redistribution (Kiro Req 4.7/4.9/10.3) is unchanged and runs *before* the fill.

---

## 6. Cold-start remediation for unstudied prerequisites (biggest learning gap)

Both inputs *label* unstudied prerequisites ("not yet studied") and stop. But if a concept your Saturday lecture depends on has **no cards at all**, labeling it does nothing — you walk in blind on exactly that concept.

**v2 behavior:** when an unstudied prerequisite belongs to an *imminent* next lecture (Proximity above a threshold, default lecture within 7 days):

1. Treat it as maximally urgent (`U = 1`, since fully unknown) for ranking purposes.
2. Reuse the Req 6 AI ingestion pipeline, but source the prompt from the concept's own definition/notes rather than uploaded lecture material, to generate a short **primer** + 3–5 **seed cards**.
3. Place the primer task at the front of the Prerequisite_Runway_Zone.

This converts "you're missing X" into "here's X, learn it now." It's the difference between a warning light and a fix.

> Unstudied prereqs of a *distant* lecture are still only labeled (no premature card creation), exactly as the requirements intend.

---

## 7. Multi-week look-ahead (use the known 32-week schedule)

The full curriculum is known up front, so the planner shouldn't only ever look at the single next lecture.

- Proximity weighting already distributes prereq review across the **1–2 weeks before** each lecture instead of cramming the day before.
- When the next lecture's prerequisites are already strong (no weak/unstudied), the Runway zone may begin **light** review of the *lecture-after-next's* prerequisites, scaled down by their lower Proximity. This keeps the runway productive instead of idle.
- `lookahead_days` (default 14) is user-configurable in settings.

---

## 8. Concept dedup + knowledge-graph growth on ingestion

When AI extracts concepts from attended-lecture material (Req 6), v2 adds a **resolve step** before card creation:

1. For each extracted concept, match against existing `aiml_concepts` (name match + embedding similarity, threshold ~0.85). Reuse the existing row if matched; create a new row only if genuinely new.
2. For new concepts, have the AI propose prerequisite edges into the existing graph; surface them for one-tap user confirmation.
3. Record the lecture's concepts on `lecture_schedules.extracted_concept_ids` (see §9) so Immediate Recall and Bridge know what "this lecture's concepts" are.

This is what makes Centrality and Blast Radius meaningful over 32 weeks: every lecture *grows* the graph instead of dumping orphan cards. (ChatGPT gestured at this; here it's concrete and wired to §4.)

---

## 9. Schema deltas

```sql
-- lecture_schedules (Antigravity table) + two additions
create table public.lecture_schedules (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users on delete cascade not null,
  week_number integer not null check (week_number between 1 and 99),
  title text not null check (char_length(title) between 1 and 200),
  scheduled_date date not null,
  prerequisite_concept_ids uuid[] default '{}',
  extracted_concept_ids   uuid[] default '{}',   -- NEW: concepts THIS lecture produced
  notes                   text   default null,    -- NEW: raw material / concept text for Bridge (Req 8.1)
  is_attended boolean default false,
  bridge_cache jsonb default null,
  bridge_cache_key text default null,             -- see §10.4 (content-aware key)
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table public.lecture_schedules enable row level security;
create policy "Users manage own lecture schedule"
  on public.lecture_schedules for all using (auth.uid() = user_id);
create index lecture_schedules_user_date_idx
  on public.lecture_schedules(user_id, scheduled_date asc, week_number asc);

-- aiml_concepts: optional cached centrality (recomputed when the graph changes).
-- This is a STRUCTURAL value, not a memory/retrievability value, so it does not
-- violate the "no separate retrievability column" rule. May also be computed in-memory.
alter table public.aiml_concepts add column if not exists centrality numeric default null;
```

`daily_plans.generated_plan` JSONB (no migration — already JSONB) extends each item:

```jsonc
{
  "zones": {
    "immediate_recall": { "allocated_minutes": 24, "items": [ /* ranked */ ] },
    "prerequisite_runway": { "allocated_minutes": 24, "items": [ /* ranked */ ] },
    "general_srs": { "allocated_minutes": 12, "items": [ /* ranked */ ] }
  },
  "deferred": [ /* over-budget items carried to tomorrow */ ]
}
// each item: { card_id, concept_id, priority, est_minutes, reason: "weak_prereq|immediate|cold_start|overdue" }
```

`users.settings` jsonb keys:

```jsonc
{
  "timezone": "Asia/Kolkata",                 // IANA; defaults to UTC if invalid (Req 9.4)
  "weakness_threshold": 0.85,                  // Req 3
  "zone_allocation_preferences": { "immediate_recall": 40, "prerequisite_runway": 40, "general_srs": 20 },
  "priority_weights": { "centrality": 0.30, "blast": 0.45, "proximity": 0.25 },  // NEW
  "lookahead_days": 14                         // NEW
}
```

---

## 10. API / lib deltas

Antigravity's routes are kept. Changes:

### 10.1 `/lib/planning-engine.ts` (extended)
```ts
resolveCurrentDate(tz: string): string                       // Req 9
getNextLecture(schedules, date): Lecture | null              // Req 9/10
getMostRecentLecture(schedules, date): Lecture | null
classifyPrerequisites(conceptIds, cards, threshold)          // weak | unstudied | strong
scorePriority(concept, graph, nextLecture, weights): number  // §4 (NEW)
estimateCardMinutes(card): number                            // §5.1 (NEW)
fillZone(items, allocatedMinutes): { items, deferred }       // §5.2 (NEW)
generateZonePartitionedPlan(userId, date, options): DailyPlan
```

### 10.2 `/lib/concept-graph.ts` (NEW)
```ts
computeCentrality(concepts): Map<id, number>     // transitive fan-out, normalized
computeBlastRadius(prereqId, lecture, graph): number
```

### 10.3 Ingestion route `/app/api/lectures/[id]/attend` (extended)
Adds the §8 resolve step (dedup + graph linking + write `extracted_concept_ids`) and §6 cold-start hook. All Kiro Req 6 rules retained: 3–5 cards, `source_type = 'aiml_concept'`, idempotent re-attend, retryable on <3 concepts, due today in `User_Time_Zone`, placed at front of Immediate Recall.

### 10.4 Bridge route `/app/api/lectures/bridge` (cache key fixed)
```
bridge_cache_key = hash(
  most_recent.extracted_concept_ids + most_recent.concept_updated_at +
  next.prerequisite_concept_ids     + next.prereq_concept_updated_at
)
```
Hashing **content version (updated_at), not just IDs**, so editing a concept's text invalidates the cache as Req 8.3 requires. All Kiro Req 8 edge cases (no recent / no next / neither / AI failure) retained.

### 10.5 Readiness route `/app/api/metrics/readiness` (NEW — §12)
Returns per-lecture readiness and retention trajectory for the weekly dashboard.

### 10.6 Settings `/app/api/lectures/settings` (extended)
Adds validated `priority_weights` (each 0–1, sum to 1) and `lookahead_days` (1–60) alongside Kiro's threshold and zone-allocation validation.

---

## 11. Changes to the formal requirements

Everything in Kiro's doc stands **except** the following, which v2 supersedes:

- **Req 2.3** (rank weak prereqs by retrievability ascending) → ranked by **Priority** (§4). Retrievability becomes the urgency input, not the sole sort key. Determinism (Req 2.6) preserved via the §4.4 tie-break chain.
- **Req 4.3** (Runway includes ranked weak prereqs) → Runway includes **priority-ranked** weak prereqs **plus cold-start primers** for imminent unstudied prereqs (§6), filled to the minute budget with overflow deferred (§5).
- **Req 4** zone fill → now capacity-aware (§5); empty-zone redistribution (4.7/4.9/4.10) unchanged and runs before fill.
- **Req 7.1–7.2** (label unstudied prereqs) → still label, **but** imminent unstudied prereqs additionally generate a cold-start task (§6).
- **Req 8.3** (cache invalidation) → key is content-aware (§10.4), not ID-only.

New requirements introduced by v2:
- **Centrality & Blast Radius** computed from the concept graph; centrality optionally cached.
- **Concept resolve/dedup + graph linking** on ingestion (§8).
- **Card-time estimation** and **deferred overflow** (§5).
- **Weekly readiness feedback loop** (§12).
- **Multi-week look-ahead** governed by `lookahead_days` (§7).

---

## 12. Feedback loop — "stronger every week"

The stated goal is compounding strength, so the system must *measure* it:

- **Lecture readiness score** = average retrievability of a lecture's prerequisites, captured at the moment its scheduled date arrives. Trending up week over week = the Runway is working.
- **Retention trajectory** = rolling average retrievability across all Concept_Cards, plotted weekly.
- **Coverage** = fraction of each lecture's prerequisites that are studied (have ≥1 card) by lecture day.
- **Optional auto-tune** (suggest, don't force): if readiness is consistently low, suggest raising the weakness threshold or shifting more minutes to Runway; if Immediate Recall cards keep lapsing, suggest more Immediate Recall minutes.

Surface these on a weekly dashboard. This is the layer that makes MasteryOS a *learning system that learns about the learner*, not just a scheduler.

---

## 13. Decisions & open questions

1. **Upload format** — pasted text + markdown for v1; PDF (via Supabase Storage) in a fast follow. Keeps ingestion simple while honoring Req 6.2's "e.g." list.
2. **Cron** — Vercel Cron (`vercel.json`) is the lower-friction choice for `/api/cron/daily-plans`; `pg_cron + net.http_post` if you'd rather keep it in Supabase. Auth via `Bearer <CRON_SECRET>` either way (Req 5).
3. **Settings location** — embed threshold / zone / weights / timezone in the Schedule page for v1; promote to a dedicated `/settings` route later.
4. **Centrality freshness** — recompute on graph mutation (lecture ingested or prereq edges edited), not per-plan, and cache in `aiml_concepts.centrality`. In-memory recompute is acceptable while the graph is small.
5. **Concurrency** — `attend` regeneration and the cron run can both write today's plan. Use upsert keyed on `(user_id, date)` with last-write-wins, and have `attend` re-run generation *after* card creation so its result is authoritative for the day.

---

## 14. Phased build order

1. **Schema** — `lecture_schedules` (+ `extracted_concept_ids`, `notes`), optional `aiml_concepts.centrality`, settings keys.
2. **Schedule CRUD** — Kiro Req 1, full validation + RLS.
3. **Planning engine, flat** — zones + Kiro allocation math (Req 4), ranked by retrievability only. Ship and verify the math sums to `daily_goal_minutes`.
4. **Intelligence layer** — `concept-graph.ts`, priority scoring, card-time, capacity fill (§4–§5).
5. **Ingestion** — attend + AI extraction + dedup/graph linking + Immediate Recall (§8, Req 6).
6. **Cold-start remediation** (§6).
7. **Cron + on-demand generation** (Req 5).
8. **Pre-Class Prep + Bridge views** (Req 7–8) with content-aware cache.
9. **Multi-week look-ahead** (§7).
10. **Readiness dashboard** (§12).

Steps 1–3 give a working planner; step 4 is where it becomes a tutor; steps 9–10 are where it compounds.
