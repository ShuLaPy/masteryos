# DSA Problem Page Enhancements — Spec & Build Guide

Covers: AI Explain blueprint, video solutions, company tags, pre-fill from
problem_bank, and additional DSA track improvements.

---

## 1. What gets built

| Feature | What it does |
|---|---|
| AI Explain | Cached markdown "blueprint" article per problem: brute force → optimal → intuition → detection signals |
| Video solutions | Top YouTube solutions shown on the problem page, fetched from enriched problem_bank |
| Company tags | Which companies ask this problem, shown as badges |
| Pre-fill | Paste a LeetCode URL → form auto-fills title, difficulty, patterns, tags |
| Dataset enrichment | One-time script enriches problem_bank with videos + companies from the zubyj dataset |

---

## 2. Schema migration

```sql
-- Enrich problem_bank with video + company data from the zubyj dataset.
-- Run AFTER the enrichment script (Phase A).
alter table public.problem_bank
  add column if not exists company_tags text[] default '{}',
  add column if not exists video_solutions jsonb default '[]',
  add column if not exists elo_rating integer default null;

-- GIN index so "problems asked by Google" queries stay fast.
create index if not exists problem_bank_companies_idx
  on public.problem_bank using gin (company_tags);

-- Cache the AI explanation per solved problem.
-- Lives on dsa_problems (your solved problems), not problem_bank (the catalog).
alter table public.dsa_problems
  add column if not exists ai_explanation text default null,
  add column if not exists ai_explanation_generated_at timestamptz default null,
  add column if not exists ai_explanation_model text default null;
-- ai_explanation_model stores which model + prompt version generated it,
-- so you can invalidate cache when you improve the prompt.
```

---

## 3. Dataset enrichment script (Phase A)

**Before writing the script, paste one entry from problem_data.json here.**
The field names vary by dataset version. Once you share a sample entry the
script will be exact. In the meantime, here is the script structure — fill
in the field names (marked TODO) after checking the sample:

```typescript
/**
 * scripts/enrich-problem-bank.ts
 *
 * Enriches problem_bank with company tags and video solutions from the
 * zubyj/leetcode-explained dataset.
 *
 * Run:  npx tsx scripts/enrich-problem-bank.ts
 *
 * Place the dataset at: supabase/seed/problem_data.json
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY");
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL!,
  SERVICE_ROLE_KEY!
);

type RawVideo = { embedded_url: string; channel: string };
type RawCompany = { name: string; score: number };
type RawQuestion = {
  title: string;
  id: number;
  difficulty_lvl: number;
  acceptance: number;
  videos: RawVideo[];
  companies: RawCompany[];
};

type VideoRow = { video_id: string; channel: string; embed_url: string };

/** Derive LeetCode slug from title — matches how LeetCode generates slugs. */
function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")  // remove special chars (parens, commas, etc.)
    .trim()
    .replace(/\s+/g, "-");         // spaces → hyphens
}

/** Extract YouTube video ID from an embed URL. */
function extractVideoId(embedUrl: string): string {
  // "https://www.youtube.com/embed/KLlXCFG5TnA" → "KLlXCFG5TnA"
  return embedUrl.split("/embed/")[1]?.split("?")[0] ?? "";
}

async function main() {
  const rawPath = join(process.cwd(), "supabase", "seed", "problem_data.json");
  const { questions }: { questions: RawQuestion[] } = JSON.parse(
    readFileSync(rawPath, "utf8")
  );

  // Load all slugs + titles from problem_bank so we only update rows we have.
  const { data: bankRows, error: loadErr } = await supabase
    .from("problem_bank")
    .select("slug, title");
  if (loadErr) { console.error("Failed to load problem_bank:", loadErr.message); process.exit(1); }

  const slugByTitle = new Map<string, string>();
  for (const row of bankRows ?? []) slugByTitle.set(row.title.toLowerCase(), row.slug);
  const bankSlugs = new Set(bankRows?.map((r) => r.slug) ?? []);

  let updated = 0, skipped = 0, noMatch = 0;

  for (const q of questions) {
    // Match by title first (most reliable), fall back to derived slug.
    const derivedSlug = titleToSlug(q.title);
    const slugFromTitle = slugByTitle.get(q.title.toLowerCase());
    const slug = slugFromTitle ?? (bankSlugs.has(derivedSlug) ? derivedSlug : null);

    if (!slug) { noMatch++; continue; }

    // Companies — names only, already sorted by score desc in the dataset.
    const company_tags = q.companies.map((c) => c.name);

    // Videos — store videoId + channel + embedUrl so the UI can derive
    // thumbnail and watch URL without extra parsing.
    const video_solutions: VideoRow[] = q.videos
      .slice(0, 5)
      .map((v) => ({
        video_id: extractVideoId(v.embedded_url),
        channel: v.channel,
        embed_url: v.embedded_url,
      }))
      .filter((v) => v.video_id); // drop any that failed to parse

    const { error } = await supabase
      .from("problem_bank")
      .update({
        company_tags,
        video_solutions,
        acceptance_rate: q.acceptance,
      })
      .eq("slug", slug);

    if (error) { console.error(`Failed ${slug}:`, error.message); }
    else updated++;
  }

  console.log(`\nDone. Updated: ${updated}  Skipped (not in bank): ${skipped}  No match: ${noMatch}`);
  console.log(`Dataset size: ${questions.length}  Bank size: ${bankRows?.length ?? 0}`);

  // Sanity check — show a few enriched rows.
  const { data: sample } = await supabase
    .from("problem_bank")
    .select("slug, company_tags, video_solutions, acceptance_rate")
    .not("company_tags", "eq", "{}")
    .limit(3);

  console.log("\nSample enriched rows:");
  sample?.forEach((r) => {
    console.log(`  ${r.slug}`);
    console.log(`    companies: ${r.company_tags?.slice(0, 3).join(", ")}`);
    console.log(`    videos:    ${(r.video_solutions as VideoRow[])?.length ?? 0} videos`);
    console.log(`    acceptance: ${((r.acceptance_rate ?? 0) * 100).toFixed(1)}%`);
  });
}

main();
```

**Add to package.json:**
```json
"enrich:problems": "tsx scripts/enrich-problem-bank.ts"
```

**Run:**
```bash
npm run enrich:problems
```

**Verify:**
```sql
select slug, company_tags, jsonb_array_length(video_solutions)
from problem_bank
where array_length(company_tags, 1) > 0
limit 5;
```

---

## 4. Pre-fill API (Phase B)

**Claude Code prompt:**
```
Read CLAUDE.md and AGENTS.md.

Create app/api/dsa/prefill/route.ts (GET, authenticated).
Query param: ?slug=two-sum OR ?url=https://leetcode.com/problems/two-sum/

1. Extract the slug:
   - If url param: parse the slug from the URL path
     (new URL(url).pathname.split('/').filter(Boolean)[1])
   - If slug param: use directly

2. Query problem_bank by slug:
   select slug, title, difficulty, patterns, leetcode_url,
          company_tags, video_solutions
   from problem_bank where slug = $1

3. If found: return { data: { prefill: { ...fields } }, error: null }
   If not found: return { data: { prefill: null }, error: null }
   (not-found is not an error — user may be adding a problem not in the bank)

Use lib/supabase/server.ts. No `any`.
```

**Integrate into the Add DSA Problem form:**
```
Read CLAUDE.md, AGENTS.md, and the existing Add DSA Problem form component.

Modify the form to call /api/dsa/prefill when the user:
(a) pastes a LeetCode URL into the URL field (on blur or on change with debounce)
(b) OR selects from a searchable dropdown of problem_bank titles

On prefill response: auto-populate title, difficulty, patterns multi-select,
and store company_tags + video_solutions for later display.
Show a subtle "Pre-filled from your problem bank" confirmation line.
If no match: form stays empty, user fills manually as before.

Use TanStack Query with enabled: !!url for the prefill call.
```

---

## 5. AI Explain — the blueprint article (Phase C)

### The prompt (what the AI generates)

```
You are helping an AIML/DSA student create a quick-revision blueprint for a
LeetCode problem. Write a clear, concise article they can read in 2 minutes
to fully recall how to solve it.

Problem: {title} ({difficulty})
Primary Pattern: {patterns[0]}
URL: {url}

Structure EXACTLY as follows (use these exact markdown headings):

## Pattern Signal
2-3 sentences. What clues in the problem statement — constraints, phrasing,
or structure — tell an experienced solver which pattern to reach for?

## Brute Force
The naive approach in plain English. Why is it insufficient? 
Time: O(?) Space: O(?)

## The Insight
One short paragraph. The single key realization that unlocks the optimal solution.
This is the "aha" moment.

## Optimal Approach
Step-by-step walkthrough of the algorithm. Use a small concrete example.
Keep it tight — 5-8 steps maximum.
Time: O(?) Space: O(?)

## Detection Checklist
3-5 bullet points. Given a new problem, what signals tell you this same
pattern applies? Make these generic enough to transfer to unseen problems.

## Watch Out For
2-3 common mistakes or edge cases that trip people up on this problem.

Write for a student who solved this problem once but wants to lock in
the mental model for interviews.
```

### Claude Code prompt (Phase C)

```
Read CLAUDE.md, AGENTS.md, docs/dsa-mastery-spec.md §11 and the existing
DSA problem page/route.

--- Part 1: API route ---
Create app/api/dsa/explain/route.ts (POST, authenticated).
Body: { problemId: string }

1. Load the dsa_problems row for this problemId (must belong to current user).
2. If ai_explanation exists AND ai_explanation_generated_at is within 30 days:
   return { data: { explanation: ai_explanation, cached: true }, error: null }
3. If not cached:
   a. Also fetch the matching problem_bank row by leetcode_url slug
      to get patterns and company context.
   b. Call the LLM via lib/ai-router.ts with task='problem_selection'
      (this routes to GPT-5.4 — complex reasoning task) using the
      AI Explain prompt from the spec, substituting problem fields.
   c. Store result in dsa_problems.ai_explanation, set
      ai_explanation_generated_at=now(), ai_explanation_model='gpt-5.4'.
   d. Return { data: { explanation, cached: false }, error: null }
4. If AI fails: return error message — do NOT cache the failure.

Use lib/supabase/server.ts. No `any`.

--- Part 2: UI ---
On the DSA problem detail page, add an "AI Explain" button.
Clicking it calls /api/dsa/explain (POST).
While loading: show a skeleton/spinner.
On success: render the markdown explanation using react-markdown (or
dangerouslySetInnerHTML with a prose class if react-markdown is not installed).
Show a "Cached" or "Just generated" badge.
On error: show the error message inline.

Style the rendered markdown consistently with existing dark-mode prose.
The explanation should feel like a well-formatted article, not a chatbot reply.
```

---

## 6. Video solutions + company tags (Phase D)

```
Read CLAUDE.md, AGENTS.md, and the DSA problem detail page.

On the DSA problem detail page, when the page loads fetch the matching
problem_bank row for this problem's slug (extract from leetcode_url):
  select company_tags, video_solutions, elo_rating
  from problem_bank where slug = $slug

Display two sections:

--- Company Tags ---
Show company_tags as small pill badges below the problem title.
Use the border token (#1f2937) for the badge background, white text.
If company_tags is empty: show nothing (no empty section).
Maximum 8 badges visible, with a "+N more" pill if there are more.

--- Video Solutions ---
Show video_solutions as a horizontal row of cards (max 5).
Each card:
  - YouTube thumbnail: img src="https://img.youtube.com/vi/{videoId}/hqdefault.jpg"
    Extract videoId from the YouTube URL: new URL(url).searchParams.get('v')
    OR url.split('youtu.be/')[1]?.split('?')[0]
  - Video title (truncated to 2 lines)
  - Channel name in smaller text
  - Entire card is a link (target="_blank", rel="noopener")
If video_solutions is empty: show nothing.

Create components/app/ProblemVideoCard.tsx and components/app/CompanyTagBadge.tsx.
Both are pure display components — no state, no API calls.
Match dark-mode design system.
```

---

## 7. Additional suggestions for improving the DSA track

These are genuine improvements worth building after the above is done:

### 7.1 Pattern detection drill (highest learning value)
A separate drill mode where you see ONLY the problem title and constraints —
no difficulty label, no pattern hints. You classify the pattern yourself, then
submit. The system scores your classification (correct/close/wrong) and feeds
it into your recognition accuracy metric. This directly trains the skill that
matters most: seeing a cold problem and knowing the pattern.

### 7.2 Blind review mode
When logging an attempt, offer a toggle: "Simulate real interview" — hides the
difficulty label and pattern tags before you start. Forces you to read the problem
cold. Toggle reveals them after you've made your attempt. Simple to build, high
training value.

### 7.3 Timed attempt tracking
Record time_seconds per attempt (already in the schema). Add a timer UI to the
"Log Attempt" flow. Over time, track median time-to-solve per pattern — dropping
median time is a strong signal of genuine fluency, not just problem familiarity.

### 7.4 Company-targeted practice mode
Given the company_tags data you now have, add a "Prepare for [Company]" mode:
filter problem_bank by company, sort by your personal weakness across the
tagged patterns, suggest a 5-problem session. Useful for interview prep with
a specific company in mind.

### 7.5 Re-solve scheduling (the ladder — from the main spec)
Already in the spec (§5.3) but worth calling out as high value: after solving
a problem, schedule it for a quick insight-recall (30s) tomorrow, an approach-
sketch (3–5m) in 3 days, and a full re-solve (20–40m) in a week. This is the
most direct way to make solved problems stick long-term. The `ai_explanation`
article becomes the resource for the insight-recall rung.

### 7.6 Weekly competition simulation
A timed 90-minute session of 3-4 problems (1 easy, 2 medium, 1 hard) randomly
sampled from your weak patterns. Score: problems solved × difficulty weight.
Track your score weekly. Simulates real interview conditions and measures
progress on actual problem-solving, not just card recall.

---

## 8. Build order

```
Phase A  dataset enrichment script → verify company_tags + videos in problem_bank
Phase B  pre-fill API + form integration
Phase C  AI Explain endpoint + UI
Phase D  video + company tag display
Phase E  (optional, later) pattern detection drill
Phase F  (optional, later) company-targeted practice mode
```

Phase A unblocks everything else — do it first. Phases B, C, D are independent
of each other once A is done, so you can do them in any order within a session.
