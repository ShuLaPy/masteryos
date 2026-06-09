# DSA Practice Enhancements — Spec & Build Guide
## Six features: drill, blind mode, timing, company practice, re-solve ladder, weekly competition

Build in dependency order. One session per feature. Standard session opener:
```
Read CLAUDE.md, AGENTS.md, docs/dsa-mastery-spec.md before anything.
```

---

## Design decisions (locked)

| Feature | Decision |
|---|---|
| 7.1 Pattern drill | AI explains *why* a classification was right/wrong |
| 7.2 Blind mode | Hides difficulty AND patterns; reveals only after attempt submitted |
| 7.3 Timing | Background recording only (no visible timer); Chrome extension later |
| 7.4 Company practice | Smart session: time budget + target company → weak-pattern set |
| 7.5 Re-solve ladder | Routed through existing SRS; rung depth scales with card maturity; AI Explain is the answer key |
| 7.6 Weekly competition | 2 recent + 2 older (older by lowest retention); first week = 4 recent; scored & tracked |

---

## Build order (dependencies)

```
7.2 Blind mode            ← no deps, smallest
7.3 Timing                ← no deps, feeds 7.6
7.5 Re-solve ladder       ← needs srs_cards + ai_explanation (both exist)
7.4 Company practice      ← needs enriched problem_bank (done) + ratings
7.1 Pattern drill         ← needs pattern_mastery + ai-router
7.6 Weekly competition    ← needs 7.3 (timing) + retention data
```

---

## Schema deltas (one migration, run first)

```sql
-- 7.1 — log pattern detection drills (separate from solve attempts)
create table public.pattern_drill_attempts (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users on delete cascade not null,
  problem_slug text not null,
  guessed_patterns text[] not null default '{}',
  correct_patterns text[] not null default '{}',
  is_correct boolean not null,           -- exact-ish match (see scoring)
  created_at timestamptz default now() not null
);
alter table public.pattern_drill_attempts enable row level security;
create policy "Users manage own drills"
  on public.pattern_drill_attempts for all using (auth.uid() = user_id);

-- 7.6 — store competition results for the weekly score trend
create table public.weekly_competitions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users on delete cascade not null,
  problem_slugs text[] not null default '{}',
  started_at timestamptz not null default now(),
  completed_at timestamptz default null,
  score numeric default 0,               -- sum(difficulty weight × solved)
  max_score numeric default 0,
  duration_seconds integer default null,
  created_at timestamptz default now() not null
);
alter table public.weekly_competitions enable row level security;
create policy "Users manage own competitions"
  on public.weekly_competitions for all using (auth.uid() = user_id);

-- 7.2 + 7.3 — preferences in users.settings jsonb (no DDL):
--   blind_mode: boolean (default false)
-- 7.3 time_seconds already exists on problem_attempts.
-- 7.5 re-solve cards reuse srs_cards (source_type='dsa_resolve'); rung
--   derived from reps, no new column.
```

---

## 7.2 — Blind review mode

```
Read CLAUDE.md, AGENTS.md, and the DSA problem detail page + log-attempt flow.

Add a "Blind mode" toggle (persisted in users.settings.blind_mode).

When blind_mode is ON, on the DSA problem detail page and in any
"start attempt" flow:
1. Hide the difficulty badge AND the pattern tags before the user attempts.
2. Show a covered placeholder: "Difficulty & patterns hidden — classify it
   yourself first."
3. Add a "Reveal" button that ONLY appears after the user marks the attempt
   submitted (logs an attempt or clicks "I've attempted this").
4. After reveal: show difficulty + patterns normally, and (if blind mode)
   prompt: "What pattern did you think it was?" — store this as a quick
   pattern_drill_attempt (reuse the 7.1 logging) so blind attempts also
   feed recognition accuracy.

Toggle lives in DSA track settings and on the problem page header.
Default OFF. No form tags. Dark-mode design system.
```
**Verify:** toggle on → difficulty/patterns hidden → submit attempt → reveal works → guess logged.

---

## 7.3 — Background timing

```
Read CLAUDE.md, AGENTS.md, and the log-attempt flow + app/api/dsa/attempt/route.ts.

Record solve time passively (no visible timer, no pressure):
1. When the user opens a problem's "log attempt" flow or navigates to solve,
   record a client-side start timestamp (useRef / state).
2. When they submit the attempt, compute elapsed seconds and include
   timeSeconds in the POST /api/dsa/attempt body.
3. The attempt route already accepts time_seconds — ensure it persists it.
4. If the user pastes a manual time instead (some solve on LeetCode directly),
   allow an optional "time taken (minutes)" field in the log form that
   overrides the auto-tracked value.

No visible timer UI. This is groundwork for a future Chrome extension that
will track real solve time on leetcode.com.
```
**Verify:** log an attempt → `problem_attempts.time_seconds` populated.

---

## 7.5 — Re-solve ladder (through existing SRS)

```
Read CLAUDE.md, AGENTS.md, docs/dsa-mastery-spec.md §5.3, lib/fsrs.ts,
and the existing Daily Review card flow.

--- Part 1: create re-solve cards ---
When a problem is marked solved (in the log-attempt flow), create a re-solve
card in srs_cards if one doesn't already exist for that problem:
  source_type = 'dsa_resolve', source_id = problem_id, state = 'new',
  due per FSRS for a new card.

--- Part 2: render the ladder in Daily Review ---
When a 'dsa_resolve' card comes due in Daily Review, render the LADDER UI
instead of a normal flashcard. The rung is derived from the card's reps:

  reps 0-1  → RUNG 1: Insight Recall (~30s)
    Show problem title only. "Recall the key insight that cracks this."
    Reveal button shows the "## The Insight" section of the problem's
    ai_explanation (fetch from dsa_problems.ai_explanation; if missing,
    generate via /api/dsa/explain first).

  reps 2-3  → RUNG 2: Approach Sketch (~3-5m)
    "Sketch the full approach (mentally or on paper)."
    Reveal shows the "## Optimal Approach" section of ai_explanation.

  reps 4+   → RUNG 3: Full Re-Solve (~20-40m)
    "Open LeetCode and solve it again from scratch."
    Show the LeetCode link. After they return, they rate how it went
    (the standard outcome options) — this logs a problem_attempt via the
    Phase 3 /api/dsa/attempt logic, feeding Glicko-2.

--- Part 3: grading ---
All three rungs end with the standard FSRS grade buttons (Again/Hard/Good/Easy).
Grading updates the card's FSRS state via lib/fsrs.ts and schedules the next
occurrence. As reps grow, the rung escalates automatically.

Create components/app/ResolveLadderCard.tsx for the Daily Review render.
Reuse lib/fsrs.ts for all scheduling — never reimplement FSRS.
```
**Verify:** solve a problem → re-solve card created → appears in Daily Review as Rung 1 → grading schedules next → after enough reps, escalates to Rung 2/3.

---

## 7.4 — Company-targeted practice (smart session)

```
Read CLAUDE.md, AGENTS.md, docs/dsa-mastery-spec.md §9, and lib/dsa-coach.ts.

Create app/api/dsa/company-session/route.ts (POST, authenticated).
Body: { company: string, timeBudgetMinutes: number }

1. Query problem_bank where company = ANY(company_tags).
2. For each candidate, look at its patterns[]; compute the user's weakness on
   those patterns (weaknessFromMastery from lib/pattern-rating.ts, using
   pattern_mastery rows). Score each problem by max weakness across its patterns.
3. Estimate per-problem time by difficulty (easy ~20m, medium ~35m, hard ~50m).
4. Greedily select problems — highest weakness first, mixing difficulty — until
   the cumulative estimated time fills timeBudgetMinutes. Exclude problems the
   user already solved well (recent successful attempt).
5. Pass the shortlist + the user's weak-pattern context to the LLM via
   lib/ai-router.ts (task='problem_selection', GPT-5.5). The LLM orders them
   into a sensible session and writes a one-line rationale per problem
   ("warm up with this two-pointer, then the harder graph problem Google favors").
   LLM only ranks/justifies the shortlist — never invents problems.
6. Return { data: { company, session: [{ slug, title, difficulty, url,
   patterns, rationale }], totalEstimatedMinutes }, error }

Create a UI: app/(dashboard)/dsa/company-practice/page.tsx
- Company picker (searchable, from distinct company_tags in problem_bank)
- Time budget input (default 60 min)
- "Build my session" button → calls the API
- Renders the session as an ordered checklist with LeetCode links + rationales
- Each item links into the normal log-attempt flow

Add a link to this page from the DSA track page.
```
**Verify:** pick Google + 60 min → returns a real, ordered set of Google-tagged problems weighted to your weak patterns, fitting the time budget.

---

## 7.1 — Pattern detection drill

```
Read CLAUDE.md, AGENTS.md, docs/dsa-mastery-spec.md §11, lib/ai-router.ts.

Create app/api/dsa/drill/route.ts with two operations:

--- GET (start a drill) ---
1. Pick a problem from problem_bank the user hasn't drilled recently,
   biased toward their weak patterns (use pattern_mastery + lib/dsa-coach.ts).
2. Return { data: { slug, title, difficulty, constraints }, error }
   — return ONLY title + difficulty + a brief constraints/setup line.
   Do NOT return the patterns (that's what the user must guess).
   If you don't store constraints, fetch a one-line problem summary via
   the LLM once and cache it, or use the title alone.

--- POST (submit a guess) ---
Body: { slug, guessedPatterns: string[] }
1. Load the problem's real patterns[] from problem_bank.
2. Score: is_correct = guessed set overlaps the primary pattern
   (guessedPatterns includes problem.patterns[0]).
3. Log a pattern_drill_attempt row.
4. Call the LLM via lib/ai-router.ts (task='problem_selection', GPT-5.5):
   "The student saw '{title}' and guessed it uses: {guessedPatterns}.
    The actual patterns are: {realPatterns}. In 3-4 sentences, explain
    whether their classification was right, partially right, or wrong, and
    WHY — what signal in the problem points to the correct pattern. Be
    encouraging and concrete."
5. Return { data: { isCorrect, realPatterns, explanation }, error }

UI: app/(dashboard)/dsa/drill/page.tsx
- "Start Drill" → shows title + difficulty + constraints, hides patterns
- A multi-select of the 25 canonical patterns (import CANONICAL_PATTERNS
  from lib/pattern-map.ts) for the user to pick their guess
- Submit → shows correct/partial/wrong + the AI explanation + the real patterns
- "Next" button for another drill
- Show a running session accuracy (X/Y correct)

This feeds the recognition-accuracy metric on the DSA track page.
```
**Verify:** start drill → only title/difficulty shown → guess patterns → get correct/wrong + AI reasoning → accuracy logged.

---

## 7.6 — Weekly competition

```
Read CLAUDE.md, AGENTS.md, lib/pattern-rating.ts, and the existing srs_cards
/ problem_attempts data.

Create app/api/dsa/competition/route.ts with:

--- POST /start ---
1. Pool A = problems the user attempted in the last 7 days (distinct slugs).
2. Pool B = problems attempted before the last 7 days, ordered by LOWEST
   retention first (use getRetrievability on their dsa_resolve cards; most
   decayed = best to test).
3. Selection:
   - If Pool B is empty (first week): pick 4 from Pool A.
   - Else: 2 from Pool A (random) + 2 from Pool B (lowest retention).
   - If a pool can't fill its quota, backfill from problem_bank filtered to
     the user's weak patterns (lib/dsa-coach.ts), mixing difficulty.
4. Create a weekly_competitions row (problem_slugs, started_at=now, max_score
   = sum of difficulty weights: easy 1, medium 2, hard 3).
5. Return { data: { competitionId, problems: [{ slug, title, difficulty, url }],
   maxScore, durationMinutes: 90 }, error }

--- POST /complete ---
Body: { competitionId, results: [{ slug, solved: boolean }] }
1. Compute score = sum(difficulty weight for each solved problem).
2. Update the row: completed_at, score, duration_seconds.
3. Each solved problem also logs a problem_attempt (feeds Glicko-2).
4. Return { data: { score, maxScore, percentile?: null }, error }

UI: app/(dashboard)/dsa/competition/page.tsx
- "Start this week's competition" → shows 4 problems + a 90-min countdown
  (this timer IS visible — competition simulates real pressure, unlike 7.3)
- LeetCode links; checkboxes to mark solved
- "Finish" → submits results, shows score / max score
- A history chart (Recharts) of weekly competition scores over time —
  this is the motivating progress trend.

Add a "Weekly Competition" entry to the DSA track page or sidebar.
```
**Verify:** start → 4 problems (2 recent + 2 decayed, or 4 recent in week 1) →
90-min timer → finish → score recorded → history chart shows the trend.

---

## Summary

```
Migration       pattern_drill_attempts + weekly_competitions tables
7.2 Blind mode  toggle, hides difficulty+patterns until attempt submitted
7.3 Timing      passive background solve-time recording
7.5 Ladder      re-solve via SRS, rung scales with maturity, AI Explain = answer key
7.4 Company     smart session: time budget + company → weak-pattern set (LLM ranked)
7.1 Drill       cold pattern classification + AI feedback on why
7.6 Competition 2 recent + 2 decayed, timed, scored, weekly trend
```

Each is independently shippable. Migration first, then build in the order above.
The two visible-timer/pressure features (7.6 competition) are intentionally
distinct from 7.3 (silent background timing) — different training purposes.
