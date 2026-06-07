# DSA Problem Bank & Pattern Taxonomy — Implementation Spec

This is the concrete spec for **Phase 1 + Phase 7** of the DSA Mastery layer: the canonical pattern taxonomy, the AlgoMaster-300 → 25-pattern mapping, and the seed pipeline. Build it with Claude Code the same way as Bridge & Runway.

---

## 1. What this delivers

The intelligent DSA layer (mastery rating, coach, suggestions) only works if every problem carries clean, canonical pattern tags. AlgoMaster organizes the 300 problems into **59 fine-grained groups**; LeetCode tags them with **59 topics**. Both are noisy and too granular for a coach. This spec normalizes everything into **25 canonical patterns** and loads 300 real, tagged problems into `problem_bank`.

Validated against your uploaded CSV: all 59 groups and all 59 topics map, every problem resolves to ≥1 pattern, all 25 canonical patterns are populated.

---

## 2. The 25 canonical patterns

```
arrays  strings  two_pointers  sliding_window  prefix_sum  hashing
binary_search  sorting  linked_list  stack  monotonic_stack  heap
tree  bst  trie  graph_traversal  advanced_graph  backtracking
dynamic_programming  greedy  intervals  bit_manipulation  math_geometry
design  matrix
```

Resulting distribution across the 300 problems (problems tagged with each pattern; totals exceed 300 because of secondary tags):

```
graph_traversal 69   hashing 68   dynamic_programming 68   math_geometry 55
tree 43   heap 38   sorting 37   stack 34   binary_search 32   design 29
linked_list 26   two_pointers 24   matrix 24   advanced_graph 23   bst 20
sliding_window 20   greedy 20   backtracking 16   bit_manipulation 14
prefix_sum 11   arrays 10   trie 10   strings 9   monotonic_stack 9   intervals 7
```

This shape is correct — it mirrors real interview weight (graphs, hashing, DP dominate).

---

## 3. The mapping strategy (why two columns, not one)

Your CSV has **both** `pattern` (AlgoMaster group) and `topics` (LeetCode tags). The mapping uses both:

- **Primary** = the AlgoMaster group, mapped via `GROUP_MAP`. This is the curated "what is this problem teaching" signal.
- **Secondary enrichment** = the LeetCode `topics`, mapped via `TOPIC_MAP`. This recovers the real technique for problems filed under generic buckets. Example: `move-zeroes` sits in AlgoMaster's "Arrays" group, but its topics include `two-pointers`, so it resolves to `["arrays", "two_pointers"]`. Without enrichment, "you're weak at arrays" is useless; with it, "you're weak at two_pointers" is actionable.

Generic topics (`array`, `string`, `simulation`, `interactive`, `randomized`) map to `null` and are skipped, so secondaries stay meaningful.

**Fold decisions** (documented so you can override): all DP variants (1-D, String, 2D Grid, Knapsack, LIS, Digit, Bitmask, Probability, State Machine, Kadane, Tree/Graph DP) → `dynamic_programming`; all four tree traversals → `tree`; Shortest Path / Topological Sort / Union Find / MST / Eulerian → `advanced_graph`; Heaps / Two Heaps / Top-K / K-Way Merge → `heap`; Stacks / Queues → `stack`; Monotonic Queue → `sliding_window`; Merge Sort / QuickSelect / Bucket Sort → `sorting`; Segment Tree / BIT / Data Stream → `design`; Math / Geometry / Divide & Conquer / Recursion → `math_geometry`.

The mapping is **code, not data**: the CSV stays raw; `lib/pattern-map.ts` holds the maps. To re-tag, edit the maps and re-run the seed — never hand-edit 300 rows.

---

## 4. Files

```
supabase/seed/algomaster_problems.csv   ← your raw upload, unchanged
                                           (columns: slug,title,difficulty,topics,pattern,leetcode_url)
lib/pattern-map.ts                        ← canonical patterns + GROUP_MAP + TOPIC_MAP
                                             + PATTERN_IMPORTANCE + toPatterns()
scripts/seed-problem-bank.ts              ← reads CSV, applies map, upserts problem_bank
```

`lib/pattern-map.ts` and `scripts/seed-problem-bank.ts` are provided ready-to-drop-in. `PATTERN_IMPORTANCE` (0–1 per pattern) feeds the **Frequency** term of `PatternPriority` in the DSA spec §7 — it is the single place to tune "which patterns matter most for my goals."

---

## 5. Schema (from DSA spec §12 — restated here)

```sql
create table public.problem_bank (
  id uuid default uuid_generate_v4() primary key,
  slug text not null unique,
  title text not null,
  difficulty text not null check (difficulty in ('easy','medium','hard')),
  patterns text[] not null default '{}',
  leetcode_url text not null,
  acceptance_rate numeric default null
);
alter table public.problem_bank enable row level security;
create policy "Anyone authenticated can read problem bank"
  on public.problem_bank for select using (auth.role() = 'authenticated');
create index problem_bank_patterns_idx on public.problem_bank using gin (patterns);
create index problem_bank_difficulty_idx on public.problem_bank (difficulty);
```

The GIN index on `patterns` makes the suggestion query (`patterns && ARRAY[...]`) fast.

---

## 6. How the rest of the DSA layer consumes this

- **Pattern Mastery (Glicko-2)** — a `problem_attempt` credits every pattern in that problem's `patterns[]`. Multi-pattern problems update multiple ratings.
- **Coach (§8)** — the target distribution is weighted by `PATTERN_IMPORTANCE`; actual distribution comes from recent attempts. The 25 keys are the axis of the mastery heatmap.
- **Suggestion engine (§9)** — filters `problem_bank` by `patterns && target_patterns` ∩ ZPD difficulty ∩ not-yet-attempted, then the LLM ranks from that real candidate set (never invents problems).

---

## 7. Build steps (Claude Code prompts)

**Step A — schema**
```
Read docs/dsa-mastery-spec.md §12 and docs/dsa-problem-bank-spec.md §5.
Create the migration supabase/migrations/<timestamp>_problem_bank.sql with the
problem_bank table, RLS read policy, GIN index on patterns, and difficulty index.
Then give me the command to apply it and regenerate types/database.ts.
```

**Step B — taxonomy + seed (drop in the provided files, then verify)**
```
I'm adding three files: lib/pattern-map.ts, scripts/seed-problem-bank.ts, and
supabase/seed/algomaster_problems.csv (already created).

1. Verify lib/pattern-map.ts type-checks and exports CANONICAL_PATTERNS,
   GROUP_MAP, TOPIC_MAP, PATTERN_IMPORTANCE, toPatterns.
2. Verify scripts/seed-problem-bank.ts imports toPatterns from lib/pattern-map
   and reads supabase/seed/algomaster_problems.csv.
3. Add an npm script "seed:problems": "tsx scripts/seed-problem-bank.ts" to package.json.
4. Install tsx as a devDependency if it isn't present.
Do not change the maps — they are validated.
```

Then run:
```bash
npm run seed:problems
```
Expected output: `Upserted 300 problems.` followed by the distribution in §2.

**Step C — wire importance into priority**
```
In lib/dsa-planner.ts patternPriority(), import PATTERN_IMPORTANCE from
lib/pattern-map.ts and use it as the Frequency term F (already specified in
docs/dsa-mastery-spec.md §7). No other changes.
```

---

## 8. Verification

- `select count(*) from problem_bank;` → 300.
- `select pattern, count(*) from problem_bank, unnest(patterns) as pattern group by 1 order by 2 desc;` → matches §2.
- `select count(*) from problem_bank where 'two_pointers' = any(patterns);` → 24.
- Re-run `npm run seed:problems` → still 300 rows (idempotent upsert, no duplicates).
- Suggestion query smoke test: `select slug,title,difficulty from problem_bank where patterns && array['graph_traversal'] and difficulty='medium' limit 5;`

---

## 9. Adjusting the taxonomy later

If you want finer granularity (e.g., split `advanced_graph` into `union_find` + `shortest_path`, or break out `kadane`):
1. Add the new key(s) to `CANONICAL_PATTERNS` and `PATTERN_IMPORTANCE`.
2. Repoint the relevant `GROUP_MAP` / `TOPIC_MAP` entries.
3. Re-run `npm run seed:problems`.
No migration, no CSV edits, no attempt-history loss (ratings key off pattern strings, so only re-tag patterns you actually renamed).
