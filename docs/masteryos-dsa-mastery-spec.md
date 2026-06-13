# MasteryOS — Intelligent DSA Practice Layer ("Pattern Mastery & Coach")
## Specification v1

A companion to the Bridge & Runway spec, built the same way (Claude Code, phase-wise, governed by `CLAUDE.md` + `AGENTS.md`). Where Bridge & Runway schedules *knowledge retention*, this schedules *skill acquisition* — pattern recognition and problem-solving fluency for DSA, with a built-in coach that keeps practice balanced and suggests real next problems.

---

## 1. North Star

The learner should get measurably better at **recognizing which pattern a novel problem needs and executing it under medium/hard difficulty** — and should never waste weeks grinding one pattern while others decay. The system must:

1. **Track real skill, not card counts** — per-pattern mastery that accounts for difficulty and decay.
2. **Train recognition, not definitions** — drill trigger→technique mappings, interleaved.
3. **Re-solve, not just review** — graduated retrieval for medium/hard problems.
4. **Coach actively** — detect over-indexing, surface neglected high-value patterns.
5. **Suggest real problems** — concrete LeetCode picks at the right difficulty, from a verified bank.
6. **Show it daily** — a DSA track brief that says exactly what to do next.

---

## 2. Why the current approach is insufficient (one paragraph)

SRS cards on "the concept of a pattern" train *definition recall*, but medium/hard performance needs *recognition* (seeing a cold problem and classifying it) and *transfer* (executing the technique). Those are different cognitive operations — transfer-appropriate processing says practice must match the target task. Definition cards also can't represent skill against difficulty: knowing what sliding window *is* says nothing about whether you can crack a hard sliding-window problem. This layer fixes both: a recognition/insight card system (memory) plus a rating-based skill model (performance).

---

## 3. Architecture

```
problem_attempts ──► Glicko-2 rating engine ──► pattern_mastery (rating + RD per pattern)
       │                                                │
       │                                                ├─ DSA Coach (coverage drift / rebalance)
       │                                                ├─ Pattern priority (weakness × importance × gap)
       │                                                └─ ZPD problem selection (difficulty fit)
       │
recognition/insight cards (srs_cards, FSRS) ──► Recognition Drill Zone
       │
problem_bank (curated, real) ──► RAG problem suggestion (LLM selects, never invents)
       │
daily_plans.generated_plan.dsa ──► DSA Track page brief (computed, mentor narrates)
```

Two models, two jobs:
- **FSRS** (`lib/fsrs.ts`, unchanged) → recognition & insight *memory* cards.
- **Glicko-2** (`lib/pattern-rating.ts`, new) → pattern *skill* rating + decay.

---

## 4. Pattern Mastery Model (Glicko-2) — the skill layer

### 4.1 What it stores
One rating per `(user, pattern)`:
```
rating      μ   — skill estimate (starts ~1500)
deviation   φ   — uncertainty (RD); inflates with inactivity → decay signal
volatility  σ   — how erratic recent results are
```

### 4.2 Each problem attempt is a "match"
Map problem difficulty to an opponent rating (tunable, refine later with acceptance rate):
```
Easy   → 1300
Medium → 1550
Hard   → 1800
```
Map the attempt outcome to a score `s ∈ [0,1]`:
```
Solved unaided, fast      → 1.0
Solved with effort        → 0.7
Solved after a hint       → 0.5
Solved after seeing approach → 0.35
Failed / read full solution  → 0.0
```
Run the Glicko-2 update against the opponent rating. A problem tagged with multiple patterns updates **every** tagged pattern's rating (you used them all); the score is shared.

### 4.3 Why Glicko-2 beats FSRS here
- **Difficulty-aware**: beating an 1800 raises μ sharply; failing a 1300 drops it. Mastery means clearing problems *above* your current rating — exactly your medium/hard concern.
- **Decay is built in**: φ (RD) grows with time since last attempt. High RD = "we're no longer sure you have this." That is the review trigger, computed honestly rather than assumed.
- **Self-calibrating**: no manual thresholds per pattern.

### 4.4 Derived weakness signal (feeds priority + coach)
```
masteryGap  = clamp((targetRating − μ) / targetSpread, 0, 1)   // below where you should be
staleness   = clamp((φ − φ_fresh) / (φ_max − φ_fresh), 0, 1)    // decayed / uncertain
Weakness    = max(masteryGap, 0.6 · staleness)                  // weak OR stale
```
Defaults: `targetRating = 1650`, `targetSpread = 350`, `φ_fresh = 50`, `φ_max = 350`.

> Implementation note: Glicko-2 is a small, fully specified algorithm. Implement it in `lib/pattern-rating.ts` or use a vetted library — verify the library is maintained before adopting. Either way the rating math is server-side only.

---

## 5. Recognition & Re-solve cards (FSRS layer)

### 5.1 Two card types replace "definition" cards
- **Recognition card** — front: a compressed *problem cue* (the setup, stripped of the answer); back: the pattern + the one-line insight that cracks it. Trains classification.
- **Insight card** — front: "the key trick for {problem}"; back: the crux step. Trains the move you forget.

(Keep a small set of definition cards if you like, but recognition/insight are the high-value ones.)

### 5.2 Generation pipeline (AI)
When the learner logs a solved problem, generate cards from it:
1. Call the LLM (see §11) with the problem statement + the learner's solution/notes.
2. Prompt to return JSON: `{ cue, pattern, insight, trick }`.
3. Create a recognition card and an insight card in `srs_cards` with `source_type = 'dsa_recognition'`, `source_id = problem_id`, FSRS state `new`, due today (user timezone).
4. Deduplicate against existing cards for the same problem (don't regenerate on re-log).

### 5.3 The re-solve ladder (for medium/hard)
A single card can't carry a 30-minute problem. Schedule the *same problem* at three rungs, each FSRS-tracked:
```
Rung 1 — Recall the insight        (~30s)   frequent
Rung 2 — Sketch the approach/pseudocode (~3–5m) medium
Rung 3 — Full re-solve (actually code it)    (~20–40m) rare, gated
```
A successful Rung 3 is the ground-truth signal that the pattern stuck, and it logs a `problem_attempt` (feeding Glicko-2).

---

## 6. Daily DSA Zones (the interleaved queue)

Mirrors the Bridge & Runway zone model. Add a `dsa` section to `daily_plans.generated_plan`:

1. **Recognition Drill Zone** — due recognition/insight cards, **interleaved across patterns** (never blocked by pattern — interleaving is what builds classification skill).
2. **Re-Solve Zone** — problems due on the ladder (§5.3), priority-ranked.
3. **New Problem Zone** — 1–3 suggested *new* problems (§9) targeting neglected high-value patterns at the right difficulty.

Minute allocation works exactly like Bridge & Runway (default split, configurable, rounding remainder assigned so zones sum to the DSA daily goal; empty-zone redistribution identical). Suggested default: 35% Drill / 40% Re-Solve / 25% New.

---

## 7. Pattern Priority (which pattern to work next)

Same shape as Bridge & Runway — weakness gates, relevance is additive so high-value patterns never zero out:
```
Frequency   F = importance weight of the pattern (interview/real-world).
                Stored per pattern in lib/constants.ts. Two-pointers, BFS/DFS,
                DP, hashing → high; niche patterns → low. Normalized [0,1].

CoverageGap G = how under-practiced this pattern is recently vs its target
                share (from the Coach, §8). [0,1].

PatternPriority = Weakness × (0.15 + 0.85·(0.6·F + 0.4·G))
```
`Weakness` from §4.4. This decides which patterns dominate the Re-Solve and New Problem zones today.

---

## 8. The DSA Coach (anti-overindexing) — portfolio rebalancing

Your "stop me grinding one pattern" requirement is a rebalancing problem:

1. **Target distribution** — normalize `PatternPriority` across all patterns → each pattern's *deserved* share of practice this week.
2. **Actual distribution** — each pattern's share of attempts in the last 14 days (from `problem_attempts`).
3. **Drift** = actual − target, per pattern.
   - Strongly positive drift → **over-practiced** ("ease off sliding window").
   - Strongly negative drift on a high-priority pattern → **neglected** ("graph BFS is decaying and you haven't touched it — do these next").
4. Surface the top over-practiced and top neglected patterns in the daily brief, and bias the New Problem Zone toward neglected ones.

A single **balance score** (e.g., 1 − normalized Gini of drift) trends toward 1 as practice gets balanced — a clean weekly health metric.

---

## 9. LeetCode Problem Suggestion — retrieval, not recall

> **Hard rule: the LLM never names problems from memory — it ranks real ones from a bank.** LLMs hallucinate problem numbers/titles. Ground truth comes from `problem_bank`.

### 9.1 The bank
A curated `problem_bank` table (global, read-only to users), seeded once from a canonical list (e.g., NeetCode 150 / Blind 75 expanded — ~150–250 problems). Each row: `slug, title, difficulty, patterns[], leetcode_url, acceptance_rate (optional)`.

### 9.2 Selection flow (RAG)
1. From §7/§8, pick the target patterns (weak + neglected).
2. **Compute the ZPD difficulty** per target pattern: pick problems whose opponent rating is roughly `μ + 0.5·σ_step` above current — challenging but winnable, not crushing.
3. Filter the bank: target patterns ∩ ZPD difficulty ∩ not yet attempted by the user → candidate set.
4. Pass the candidate set + the learner's mastery context to the LLM; it **selects and ranks 3–5** and writes one line of rationale each ("you're at Medium on graphs but haven't done BFS-on-grid — start here").
5. Render in the New Problem Zone with direct LeetCode links.

The LLM does judgment; the bank guarantees the problems exist.

---

## 10. Daily insights on the DSA Track page

The surface that answers "what do I do next?" every day.

1. **Compute deterministically** (server, no LLM): mastery per pattern, week-over-week trajectory, coverage drift, neglected/over-practiced lists, ZPD suggestions.
2. **Narrate with the mentor** (LLM): turn the computed numbers into a short, motivating brief. The LLM must not compute or invent numbers — it only phrases what it's given.
3. **Render** on the DSA track page:
   - Mastery heatmap across the 25 patterns (color by rating, opacity by RD/confidence).
   - "Do next" — the 3–5 suggested problems (§9).
   - Coach line — over-practiced / neglected callouts (§8).
   - Trajectory sparkline — average rating + breadth over 8 weeks.

This reuses your existing mentor AI; it just gets a DSA-specific computed payload.

---

## 11. Model choice (you said you'll use a powerful model)

Tier by task, behind a small `lib/ai-router.ts` so the rest of the code is model-agnostic:
- **Routine, high-volume** (recognition/insight card generation): keep `gpt-5.4` — cheap, sufficient.
- **High-reasoning** (problem selection rationale, weekly coaching synthesis): use a stronger model. Your `ANTHROPIC_API_KEY` is already reserved in env — route these tasks to Claude via a new `lib/anthropic.ts` following the same `{ data, error }` pattern as `lib/openai.ts`.

`ai-router.ts` exposes `complete({ task, ... })` and picks the model per task. This keeps `CLAUDE.md`'s "AI calls server-side only" rule and avoids scattering model names through the codebase.

---

## 12. Schema deltas

```sql
-- Per-pattern skill rating (Glicko-2). One row per (user, pattern).
create table public.pattern_mastery (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users on delete cascade not null,
  pattern text not null,                      -- one of the 25 in lib/constants.ts
  rating numeric not null default 1500,
  rd numeric not null default 350,            -- Glicko deviation (uncertainty)
  volatility numeric not null default 0.06,
  attempts integer not null default 0,
  last_attempt_at timestamptz default null,
  updated_at timestamptz default now() not null,
  unique (user_id, pattern)
);
alter table public.pattern_mastery enable row level security;
create policy "Users manage own pattern mastery"
  on public.pattern_mastery for all using (auth.uid() = user_id);

-- Append-only solve log (the Glicko input; analog of `reviews` but for problems).
create table public.problem_attempts (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users on delete cascade not null,
  problem_id uuid references public.dsa_problems on delete set null,
  patterns text[] not null default '{}',      -- patterns credited this attempt
  difficulty text not null,                    -- easy | medium | hard
  outcome_score numeric not null,              -- 0.0–1.0 mapped score (§4.2)
  time_seconds integer,
  used_hints boolean default false,
  pattern_identified text,                     -- did they classify it correctly?
  created_at timestamptz default now() not null
);
alter table public.problem_attempts enable row level security;
create policy "Users manage own problem attempts"
  on public.problem_attempts for all using (auth.uid() = user_id);
create index problem_attempts_user_pattern_idx
  on public.problem_attempts(user_id, created_at desc);

-- Curated, global problem bank (read-only to users). Seeded once.
create table public.problem_bank (
  id uuid default uuid_generate_v4() primary key,
  slug text not null unique,
  title text not null,
  difficulty text not null,                    -- easy | medium | hard
  patterns text[] not null default '{}',
  leetcode_url text not null,
  acceptance_rate numeric default null
);
alter table public.problem_bank enable row level security;
create policy "Anyone authenticated can read problem bank"
  on public.problem_bank for select using (auth.role() = 'authenticated');
```

`daily_plans.generated_plan` JSONB gains a `dsa` section (no migration — already JSONB):
```jsonc
{
  "dsa": {
    "zones": {
      "recognition_drill": { "allocated_minutes": 21, "items": [ /* interleaved cards */ ] },
      "re_solve":          { "allocated_minutes": 24, "items": [ /* ladder problems */ ] },
      "new_problem":       { "allocated_minutes": 15, "items": [ /* suggested problems */ ] }
    },
    "coach": { "neglected": ["graphs_bfs"], "over_practiced": ["sliding_window"], "balance_score": 0.62 },
    "deferred": []
  }
}
```

`lib/constants.ts` — add an `importance` weight (0–1) to each of the 25 patterns. Static; rarely changes.

`users.settings` — add `dsa_daily_goal_minutes` and optional `dsa_zone_allocation_preferences`.

---

## 13. API / lib deltas

```
lib/pattern-rating.ts   — Glicko-2 update; difficultyToRating(); outcomeToScore(); weaknessFromMastery()
lib/dsa-coach.ts        — targetDistribution(); actualDistribution(); computeDrift(); balanceScore()
lib/dsa-planner.ts      — patternPriority(); zpdDifficulty(); buildDsaZones()
lib/ai-router.ts        — complete({ task }) → routes to OpenAI or Anthropic by task
lib/anthropic.ts        — Claude client, { data, error } pattern (mirrors lib/openai.ts)

app/api/dsa/attempt/route.ts        — POST: log attempt → Glicko update → trigger card gen + plan refresh
app/api/dsa/cards/generate/route.ts — POST: generate recognition/insight cards from a solved problem
app/api/dsa/suggest/route.ts        — GET: RAG problem suggestion from problem_bank
app/api/dsa/insights/route.ts       — GET: computed payload + mentor-narrated daily brief
app/api/dsa/plan/generate/route.ts  — POST: build the dsa section of today's daily_plan

app/(dashboard)/dsa/page.tsx        — DSA Track page: mastery heatmap, do-next, coach, trajectory
components/app/PatternMasteryHeatmap.tsx
components/app/DsaCoachCard.tsx
components/app/SuggestedProblemList.tsx
components/app/ReSolveLadder.tsx
```

All AI calls server-side. No raw SQL. `{ data, error }` everywhere. Pattern logic in libs, routes stay thin — same conventions as Bridge & Runway.

---

## 14. Feedback loop — measuring "stronger each week"

- **Average rating** across all patterns trending up.
- **Breadth** — number of patterns above the mastery threshold (rating ≥ target, RD low).
- **Difficulty ceiling** — highest difficulty cleared per pattern, climbing.
- **Time-to-insight** — median `time_seconds` on Rung-1 recalls dropping.
- **Balance** — coach balance score (§8) trending toward 1.
- **Recognition accuracy** — fraction of attempts where `pattern_identified` was correct.

Surface these on the DSA track page weekly. This is the proof the system is working, not just running.

---

## 15. Decisions & open questions

1. **Problem bank source** — seed from a canonical list (NeetCode 150 / Blind 75 expanded) for v1? It covers all patterns at all difficulties and is a one-time seed. Or do you have your own list in `dsa_problems` to promote into the bank? *(Needs your answer before §9 works.)*
2. **Outcome reporting** — self-reported outcome (Again/Hard/Good/Easy-style) mapped to the §4.2 score, since we can't verify a real LeetCode submission. Acceptable for v1?
3. **Glicko-2 lib vs hand-rolled** — implement the ~50-line algorithm directly (no dependency risk) or adopt a maintained library? Recommend hand-rolled for control; verify any library before use.
4. **Model routing** — confirm using Claude (`ANTHROPIC_API_KEY`) for high-reasoning tasks and gpt-5.4 for card generation, behind `ai-router.ts`.
5. **DSA goal minutes** — separate `dsa_daily_goal_minutes`, or carve the DSA zones out of the existing daily goal alongside the AIML zones?

---

## 16. Phased build order

1. **Schema** — `pattern_mastery`, `problem_attempts`, `problem_bank`; constants importance weights; regen types.
2. **Rating engine** — `lib/pattern-rating.ts` (Glicko-2, difficulty/outcome maps, weakness). Verify a few updates by hand.
3. **Attempt logging** — `/api/dsa/attempt` → updates ratings. (Now skill is tracked.)
4. **Recognition cards** — generation pipeline + re-solve ladder (`/api/dsa/cards/generate`).
5. **Coach** — `lib/dsa-coach.ts` (drift, neglected/over-practiced, balance score).
6. **Planner** — `lib/dsa-planner.ts` + `/api/dsa/plan/generate` (three zones, priority, ZPD).
7. **Problem bank seed + suggestion** — seed bank; `/api/dsa/suggest` (RAG).
8. **AI router** — `lib/ai-router.ts` + `lib/anthropic.ts`; route reasoning tasks to Claude.
9. **DSA track page** — heatmap, do-next, coach card, trajectory; `/api/dsa/insights`.
10. **Feedback metrics** — wire the §14 metrics into the page.

Stop after Phase 3 for a working skill tracker; Phase 5 makes it a coach; Phases 7–9 make it a daily guide that suggests real problems.
