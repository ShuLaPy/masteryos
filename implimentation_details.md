# MasteryOS — Analysis, Improvements & Foolproof Build Plan

## TL;DR

The original Claude plan is architecturally solid but **over-engineered for a solo/small-team build**. This revised plan cuts infrastructure complexity by ~40%, keeps the full feature set, and is optimized to be built entirely by code agents. The end product is a premium AI-powered learning OS that takes someone from beginner to master in DSA + AIML.

---

## Part 1 — Analysis of the Original Plan

### What Claude Got Right ✅

- **FSRS v5** is the correct algorithm choice. The science is sound and the retention improvement is real.
- **Cascade Mastery** (knowledge dependency graph) is a genuinely differentiated feature. No competitor does this.
- **Supabase as the backbone** — excellent call. Consolidates DB, Auth, Storage, pgvector, Realtime, and Edge Functions.
- **Cross-Domain Connection Engine** — this is the killer feature that separates serious learners from casual ones.
- **Calibration Tracking (Metacognition Engine)** — rare, research-backed, genuinely powerful.
- **Weekly Synthesis Report** — creates reflection rituals which neuroscience confirms deepens long-term retention.
- **CLAUDE.md** for agentic development — critical for code agents to work well autonomously.

### What Claude Got Wrong / Over-Engineered ❌

| Issue | Problem | Fix |
|-------|---------|-----|
| **Python FastAPI microservice for FSRS** | Separate language, separate repo, separate deployment, extra $5/month, adds latency | Use `ts-fsrs` — a production-grade TypeScript FSRS implementation. Runs in Next.js API routes. Zero extra infrastructure. |
| **Judge0 on EC2 for code execution** | You said you don't want this. It adds ~$15/month, requires Docker/EC2 management, and you're tracking LeetCode progress not running code | **Removed entirely.** DSA track integrates with LeetCode via extension or manual logging. |
| **Inngest for background jobs** | Another dashboard, another external service, webhook complexity | **Use Supabase `pg_cron` + Edge Functions** for scheduled tasks. Everything stays in one ecosystem. |
| **Monaco Editor** | Tied to the code execution (Judge0) we're removing | Not needed. Replaced with a rich notes editor (Tiptap) for approach notes and learnings. |
| **OpenAI for embeddings separately** | Two AI API keys to manage | Claude has its own embedding model (`voyage-3-lite` via Anthropic). Or just use `text-embedding-3-small` — but this is lower priority, can be added in Phase 6. |

### ChatGPT's Additions — Analysis

**Feynman 2.0 (AI as curious student):** ✅ **Brilliant, include it.** This is the difference between passive recall ("grade my answer") and active teaching ("defend your understanding against a confused 5-year-old"). Research shows teaching others is the single highest-retention learning method. The implementation is a specific Claude prompt with roleplay instructions.

**AI Mentor (orchestration layer):** ✅ **Include as the home screen experience.** This replaces a static dashboard with a living, conversational coach that has real-time context of your data. It's what makes this product feel like a personal tutor vs. a tracker.

---

## Part 2 — Feature Additions & Improvements

### New Feature: LeetCode Chrome Extension (Replaces GraphQL Sync)
LeetCode's GraphQL API requires session cookies — a security/friction nightmare. Instead, build a companion Chrome Extension:
- Detects when user submits a successful solution on LeetCode
- Extracts: problem name, difficulty, language, timestamp, solution code, tags
- POSTs directly to the MasteryOS API endpoint
- User lands on MasteryOS and just adds the pattern tag + confidence score
- **Zero cookie handling. Zero API polling. Works on submission.**

### New Feature: Spaced Review Ritual (Before Each IIT Class)
Every Friday evening, the app surfaces a "Pre-Class Prep" modal:
- "Tomorrow: Attention Mechanisms. Your prerequisites need attention:"
- Softmax → 62% retention (needs review tonight)
- Matrix Multiplication → 89% retention (good)
- Positional Encoding → Not studied yet (create concept now?)

This prevents showing up to class lost because a foundational concept decayed.

### New Feature: Problem Pattern Tagging Flow
When a DSA problem is logged (via extension or manually):
1. AI analyzes problem title/description and **auto-suggests** 2–3 patterns
2. User confirms/corrects
3. Confidence slider (1–5)
4. "Add approach notes" (Tiptap rich editor)
5. Card auto-generated for SRS

### Improved: "Teach Me" Mode (Feynman 2.0)
Not just a grader. Full Socratic conversation:
- User picks a concept → types explanation or speaks (in future)
- Claude plays confused 10-year-old / junior dev: asks "But why?" and "What does that mean?"
- Session ends with score + weak points identified
- Weak points → automatically generate new SRS cards targeting gaps

### Improved: AI Mentor as Home Screen
The Mentor isn't just an analytics page — it's the **first thing you see**. A chat interface where the Mentor greets you:
> "Good morning! You have 4 reviews due, and you've been avoiding Dynamic Programming for 6 days. Let's start with an easy DP problem to rebuild that muscle. Ready?"

It knows your full history and nudges you toward what the data says you need most.

---

## Part 3 — Simplified & Final Tech Stack

> [!IMPORTANT]
> Every technology choice below prioritizes: (1) developer velocity, (2) staying in TypeScript/one ecosystem, (3) minimizing external services.

### Frontend & Backend (One Repo)
| Tool | Why |
|------|-----|
| **Next.js 15 (App Router)** | Full-stack React. API routes, SSR, file-based routing. One repo for everything. |
| **TypeScript** | Non-negotiable for a project this complex and agent-built. |
| **Tailwind CSS + Shadcn/UI** | Fastest way to build premium UI. All accessible components included. |
| **Framer Motion** | Micro-animations: streak celebrations, card flips, retention score changes. |
| **Tiptap** | Rich text editor for notes (supports markdown, code blocks). Replaces Monaco. |
| **TanStack Query v5** | Server state management. Caching, background refetching, optimistic updates. |
| **Zustand** | Minimal client state (session, modals, UI state). |
| **Recharts + D3.js** | Charts for analytics, retention heatmaps, knowledge graph. |

### Database & Infrastructure
| Tool | Why |
|------|-----|
| **Supabase Pro** | PostgreSQL + Auth + Storage + Realtime + pgvector + Edge Functions + **pg_cron**. Replaces: RDS, Cognito, S3, vector DB, cron service. $25/month. |
| **Supabase Edge Functions** | All background jobs: daily plan gen, weekly synthesis, embedding generation. |
| **Supabase pg_cron** | Schedule Edge Functions (7am daily plan, Sunday weekly report). Native. Free. |

### AI & Intelligence
| Tool | Why |
|------|-----|
| **Anthropic Claude API** (claude-sonnet-4-5) | Core AI: Mentor, Feynman 2.0, Quiz Gen, Connection Discovery, Daily Plan. |
| **ts-fsrs** | TypeScript FSRS v5. Runs in Next.js API routes. No microservice needed. |
| **OpenAI text-embedding-3-small** | Embeddings for semantic search and cascade mastery. Only used in Edge Functions. |

### Deployment
| Component | Platform | Cost |
|-----------|----------|------|
| Frontend + API routes (Next.js) | Vercel | Free → $20/month Pro |
| Database + Auth + Storage + Jobs | Supabase Pro | $25/month |
| AI APIs | Anthropic + OpenAI | Pay-per-use (low initially) |
| **Total** | | **~$45–55/month** (saves $25/month vs. original) |

> [!NOTE]
> We eliminated: Python Railway service ($5/month), Judge0 EC2 ($15/month), Inngest (complexity). Total savings: ~$20–25/month + massive reduction in complexity.

---

## Part 4 — Complete System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      MASTERY OS                              │
│         Next.js 15 App Router (TypeScript)                   │
│                                                              │
│  [Mentor/Home] [AIML Track] [DSA Track] [Review] [Analytics]│
└──────────────────────────┬───────────────────────────────────┘
                           │
              ┌────────────▼────────────┐
              │    Next.js API Routes   │
              │  /api/review            │ ← ts-fsrs runs here
              │  /api/ai/mentor         │ ← Claude API
              │  /api/ai/feynman        │ ← Claude API
              │  /api/ai/quiz           │ ← Claude API
              │  /api/lc-sync           │ ← Chrome Extension POSTs here
              └────────────┬────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼──────┐  ┌────────▼───────┐  ┌──────▼───────┐
│  Supabase    │  │  ts-fsrs       │  │  Anthropic   │
│  PostgreSQL  │  │  (in-process)  │  │  Claude API  │
│  pgvector    │  │                │  │              │
│  Auth (JWT)  │  │  FSRS v5       │  │  Mentor      │
│  Storage     │  │  algorithm     │  │  Feynman 2.0 │
│  Realtime    │  │  running       │  │  Quiz Gen    │
│  Edge Fns    │  │  natively in   │  │  Connections │
│  pg_cron     │  │  API routes    │  │  Daily Plan  │
└──────────────┘  └────────────────┘  └──────────────┘
        │
        └─────────────────────────┐
                    ┌─────────────▼──────────────┐
                    │  Supabase Edge Functions    │
                    │  (pg_cron triggered)        │
                    │                             │
                    │  7:00am — Generate daily    │
                    │           plan + mentor msg │
                    │  Sunday  — Weekly synthesis │
                    │  On new concept — Generate  │
                    │           embedding         │
                    └─────────────────────────────┘

  ┌─────────────────────────────┐
  │   LeetCode Chrome Extension │
  │                             │
  │  Detects successful submit  │
  │  POSTs to /api/lc-sync      │
  │  Auto-creates DSA record    │
  └─────────────────────────────┘
```

---

## Part 5 — Complete Database Schema

```sql
-- Enable extensions
create extension if not exists vector;
create extension if not exists pg_cron;
create extension if not exists "uuid-ossp";

-- USERS
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  avatar_url text,
  iit_course_start_date date,
  daily_goal_minutes int default 60,
  leetcode_username text,
  streak_count int default 0,
  streak_last_date date,
  grace_days_remaining int default 1,
  settings jsonb default '{}',
  created_at timestamptz default now()
);

-- AIML CONCEPTS
create table aiml_concepts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  week_number int not null,
  title text not null,
  concept_type text check (concept_type in ('theory','math','implementation','system','all')),
  notes text,
  tags text[],
  mastery_score float default 0,
  prerequisites uuid[],             -- IDs of prerequisite concepts
  source text default 'manual',     -- 'iit_lecture', 'self_study', 'lecture_upload'
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- DSA PROBLEMS
create table dsa_problems (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  title text not null,
  platform text default 'leetcode',
  external_id text,
  url text,
  difficulty text check (difficulty in ('easy','medium','hard')),
  patterns text[],                  -- from the 25-pattern list
  approach_notes text,              -- Tiptap rich text
  time_taken_minutes int,
  confidence int check (confidence between 1 and 5),
  source text default 'manual',     -- 'manual', 'chrome_extension', 'lc_sync'
  solved_at timestamptz default now(),
  created_at timestamptz default now()
);

-- SRS CARDS
create table srs_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  card_type text check (card_type in ('concept','quiz','explain','feynman')),
  front text not null,
  back text not null,
  source_type text check (source_type in ('aiml_concept','dsa_problem','manual')),
  source_id uuid,

  -- ts-fsrs state fields
  due timestamptz default now(),
  stability float default 0,
  difficulty float default 0,
  elapsed_days int default 0,
  scheduled_days int default 0,
  reps int default 0,
  lapses int default 0,
  state text default 'New',         -- 'New', 'Learning', 'Review', 'Relearning'
  last_review timestamptz,

  created_at timestamptz default now()
);

-- REVIEWS (append-only log)
create table reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  card_id uuid references srs_cards(id) on delete cascade,
  rating int check (rating between 1 and 4),  -- 1=Again 2=Hard 3=Good 4=Easy
  duration_seconds int,
  confidence_predicted int check (confidence_predicted between 1 and 5),
  stability_before float,
  stability_after float,
  retrievability_at_review float,
  scheduled_days_after int,
  reviewed_at timestamptz default now()
);

-- STUDY SESSIONS
create table study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  session_type text check (session_type in ('srs_review','dsa_practice','aiml_study','feynman','mixed')),
  planned_minutes int,
  actual_minutes int,
  cards_reviewed int default 0,
  problems_logged int default 0,
  energy_level int check (energy_level between 1 and 5),
  mood_end int check (mood_end between 1 and 5),
  notes text,
  topics_covered text[]
);

-- DAILY PLANS
create table daily_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  plan_date date not null unique,
  mentor_message text,              -- AI morning message
  generated_plan jsonb,
  srs_due_count int,
  estimated_minutes int,
  completion_pct float default 0,
  completed_at timestamptz,
  unique(user_id, plan_date)
);

-- FEYNMAN SESSIONS
create table feynman_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  concept_id uuid references aiml_concepts(id) on delete cascade,
  conversation jsonb,               -- full chat history
  mastery_score float,              -- 0-1 from AI evaluation
  weak_points text[],               -- concepts to reinforce as SRS cards
  completed_at timestamptz default now()
);

-- CONCEPT EMBEDDINGS (pgvector)
create table concept_embeddings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  source_type text check (source_type in ('aiml_concept','dsa_problem')),
  source_id uuid not null,
  content_hash text,
  embedding vector(1536),
  created_at timestamptz default now()
);

-- WEEKLY SYNTHESES
create table weekly_syntheses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  week_number int,
  week_start_date date,
  ai_synthesis text,
  concepts_learned text[],
  problems_logged_count int,
  average_retention float,
  cross_connections jsonb,
  created_at timestamptz default now()
);

-- Indexes
create index on srs_cards(user_id, due);
create index on srs_cards(user_id, state);
create index on reviews(user_id, reviewed_at desc);
create index on concept_embeddings using hnsw (embedding vector_cosine_ops);
create index on aiml_concepts(user_id, week_number);
create index on dsa_problems(user_id, solved_at desc);
create index on dsa_problems(user_id, patterns);

-- Row Level Security (apply to all tables)
alter table users enable row level security;
alter table aiml_concepts enable row level security;
alter table dsa_problems enable row level security;
alter table srs_cards enable row level security;
alter table reviews enable row level security;
alter table study_sessions enable row level security;
alter table daily_plans enable row level security;
alter table feynman_sessions enable row level security;
alter table concept_embeddings enable row level security;
alter table weekly_syntheses enable row level security;

-- RLS Policies
create policy "Own data only" on users for all using (auth.uid() = id);
create policy "Own data only" on aiml_concepts for all using (auth.uid() = user_id);
create policy "Own data only" on dsa_problems for all using (auth.uid() = user_id);
create policy "Own data only" on srs_cards for all using (auth.uid() = user_id);
create policy "Own data only" on reviews for all using (auth.uid() = user_id);
create policy "Own data only" on study_sessions for all using (auth.uid() = user_id);
create policy "Own data only" on daily_plans for all using (auth.uid() = user_id);
create policy "Own data only" on feynman_sessions for all using (auth.uid() = user_id);
create policy "Own data only" on concept_embeddings for all using (auth.uid() = user_id);
create policy "Own data only" on weekly_syntheses for all using (auth.uid() = user_id);

-- pg_cron scheduled jobs
select cron.schedule('daily-plan-gen', '0 7 * * *', $$
  select net.http_post(
    url := current_setting('app.edge_function_url') || '/generate-daily-plans',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'))
  );
$$);

select cron.schedule('weekly-synthesis', '0 8 * * 0', $$
  select net.http_post(
    url := current_setting('app.edge_function_url') || '/generate-weekly-synthesis',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'))
  );
$$);
```

---

## Part 6 — The 25 DSA Patterns (Pre-seeded)

Arrays, Sliding Window, Two Pointers, Fast & Slow Pointers, Prefix Sum, Binary Search, Sorting, Recursion, Backtracking, Dynamic Programming (1D), Dynamic Programming (2D), Greedy, Divide & Conquer, Linked Lists, Stacks, Queues, Trees (BFS), Trees (DFS), Binary Search Trees, Heaps / Priority Queues, Tries, Graphs (BFS), Graphs (DFS), Topological Sort, Union Find

---

## Part 7 — Phased Build Roadmap

### Phase 0 — Foundation & Design System (Days 1–3)
**Goal:** Running app with auth, routing, and world-class design system.

**Deliverables:**
- Next.js 15 project initialized with TypeScript + Tailwind + Shadcn
- Supabase project created, full schema applied
- Email/password auth with session persistence
- Base layout: sidebar navigation, header
- 5 placeholder routes: Mentor, AIML, DSA, Review, Analytics
- Design tokens: color palette (dark mode first), typography (Inter font), spacing, shadows
- `CLAUDE.md` and `SCHEMA.sql` in root

**Agent Prompt:**
```
Read CLAUDE.md. Set up a Next.js 15 App Router project with Supabase auth (SSR), 
Shadcn/UI, TanStack Query v5, and Zustand. 
- Premium dark mode design: deep navy/slate background (#0a0f1e), 
  accent violet (#7c3aed), emerald green for success (#10b981)
- Inter font via next/font
- Left sidebar with icons: Mentor (home), AIML Track, DSA Track, Daily Review, Analytics
- Auth pages: /login, /signup with premium form design
- Skeleton loading states for all data sections
Apply the schema from SCHEMA.sql to Supabase. Generate TypeScript types via supabase CLI.
```

---

### Phase 1 — AI Mentor Home Screen (Days 4–6)
**Goal:** The first thing users see is an intelligent mentor greeting them.

**Deliverables:**
- Chat interface with Claude as the Mentor
- Mentor has context: due SRS count, streak, last studied topic, weak patterns
- Morning greeting message (pulled from `daily_plans` table)
- Quick action cards: "Start Review", "Log DSA Problem", "Study a Concept"
- Streak display with flame animation

**Key Claude Prompt (Mentor System Prompt):**
```
You are the user's personal AI learning mentor. You have access to their learning data:
- SRS cards due today: {due_count}
- Current streak: {streak_days} days
- Weakest AIML concept: {weakest_concept} ({retention}% retention)
- Most neglected DSA pattern: {neglected_pattern} (last solved: {days_ago} days ago)
- Today's study goal: {goal_minutes} minutes

Your job: Be a strict but encouraging coach. In 2-3 sentences max, tell them exactly 
what to focus on today and why. Be specific, data-driven, and motivating.
If they haven't studied in 2+ days, be direct about it. Celebrate streaks warmly.
```

**Agent Prompt:**
```
Read CLAUDE.md. Build the AI Mentor home screen (/app/(dashboard)/page.tsx):
1. Chat interface component with streaming Claude responses
2. API route /api/ai/mentor that fetches user context from Supabase and calls Claude
3. Streaks widget with Framer Motion flame animation
4. Quick action cards grid
5. Due reviews badge counter
Use TanStack Query to poll for updates. Keep all Claude calls server-side only.
```

---

### Phase 2 — SRS Review Engine (Days 7–10)
**Goal:** Core flashcard review loop powered by ts-fsrs.

**Deliverables:**
- Install and integrate `ts-fsrs`
- Review session page: card flip animation, rating buttons (Again/Hard/Good/Easy)
- `/api/review` endpoint: receives rating → runs ts-fsrs → updates `srs_cards` → logs to `reviews`
- Due cards query (all cards where `due <= now()`)
- Review summary screen: cards completed, retention estimate, next due dates
- Sidebar badge showing due count (real-time via Supabase Realtime)

**Agent Prompt:**
```
Read CLAUDE.md. Implement the SRS review engine:
1. Install ts-fsrs: npm install ts-fsrs
2. Create /lib/fsrs.ts — wrapper around ts-fsrs with our TypeScript types
3. API route /api/review (POST): takes {card_id, rating (1-4)}, fetches current card 
   FSRS state, runs ts-fsrs algorithm, updates srs_cards table, inserts review log
4. Review page /app/(dashboard)/review/page.tsx:
   - Fetch due cards (due <= now())
   - Card flip animation (Framer Motion, 3D flip effect)
   - Rating buttons with keyboard shortcuts (1=Again, 2=Hard, 3=Good, 4=Easy)
   - Progress bar showing cards remaining
5. Summary page after all cards reviewed: stats, celebration animation
Use optimistic updates with TanStack Query for instant card flip feedback.
```

---

### Phase 3 — AIML Knowledge Vault (Days 11–14)
**Goal:** Users can log and manage AIML concepts with rich notes.

**Deliverables:**
- Concept creation form: title, week number, type, notes (Tiptap editor), tags, prerequisites
- 32-week course map UI (visual timeline with current week highlighted)
- Concept list with search, filter by week/type/mastery
- On concept save: auto-generate 3–5 SRS cards via Claude
- Pre-class prep widget (Friday evenings)
- Lecture upload (PDF → Supabase Storage → Edge Function → Claude extracts concepts)

**Pre-seeded 32-week AIML curriculum:**
- Weeks 1–4: Linear Algebra, Probability Theory, Calculus for ML, Statistics & Hypothesis Testing
- Weeks 5–8: Regression (Linear/Logistic), Classification, SVM, Decision Trees & Ensembles
- Weeks 9–12: MLP, Backpropagation, Optimizers (SGD/Adam/AdaGrad), Regularization
- Weeks 13–16: CNNs, Object Detection, RNNs, LSTMs & GRUs
- Weeks 17–20: Text Preprocessing, Word2Vec & GloVe, Attention Basics, BERT
- Weeks 21–24: Transformer Architecture, Self-Attention, GPT models, Fine-tuning
- Weeks 25–26: Spectrograms, Speech Models (Whisper, wav2vec)
- Weeks 27–28: Vector DBs, RAG Architecture, Retrieval Systems
- Weeks 29–32: AI Agents, Tool Use, Multi-Agent Systems, LLM Evaluation

**Agent Prompt:**
```
Read CLAUDE.md. Build the AIML Track:
1. Concept form at /app/(dashboard)/aiml/new with Tiptap rich editor for notes
2. Tags multi-select with autocomplete from existing user tags
3. Prerequisites selector (searchable dropdown of existing concepts)
4. On save: API route /api/aiml/concepts (POST) → saves concept → calls Claude to 
   auto-generate 3-5 SRS cards → saves cards → triggers Edge Function for embedding
5. 32-week course map: visual grid timeline, color-coded by mastery score
   (gray=not started, yellow=learning, green=mastered)
6. Concept detail page with: notes, related SRS cards, mastery score, prerequisite graph
7. Lecture upload UI → Supabase Storage → Supabase Edge Function calls Claude to 
   extract concepts and auto-create concept records
```

---

### Phase 4 — DSA Track (Days 15–18)
**Goal:** Full DSA problem logging with pattern tracking and LeetCode integration.

**Deliverables:**
- DSA problem log form: title, URL, difficulty, patterns (multi-select from 25), approach notes (Tiptap), confidence, time taken
- AI pattern auto-suggestion from problem title/URL
- Chrome Extension (manifest v3): detects LeetCode success submission, POSTs to `/api/lc-sync`
- Pattern mastery dashboard: 25-pattern breakdown with progress bars
- On problem save: auto-generate SRS cards for the pattern
- DSA problem list with filter by pattern/difficulty/date

**Chrome Extension spec:**
```javascript
// content_script.js
// Listens for LeetCode submission success
// Grabs: problem title, difficulty, slug, timestamp, language, code
// POSTs to https://masteryos.app/api/lc-sync with user's API token
// Shows toast: "Logged to MasteryOS! Add pattern tags →"
```

**Agent Prompt:**
```
Read CLAUDE.md. Build the DSA Track:
1. Problem log form at /app/(dashboard)/dsa/log with Tiptap for approach notes
2. Pattern multi-select with all 25 pre-seeded patterns
3. AI pattern suggestion: /api/ai/suggest-patterns takes problem title/URL, 
   returns top 3 pattern suggestions from Claude
4. API route /api/lc-sync (POST): receives data from Chrome Extension 
   (validate with user API token from settings), creates dsa_problems record, 
   generates SRS cards for the pattern if not seen before
5. Pattern mastery page: 25 cards each showing problem count, avg confidence, 
   last reviewed date, mastery bar
6. Problem list with search + filter by pattern and difficulty
Build the Chrome Extension separately in /chrome-extension/ directory:
  - manifest.json (v3), content_script.js, popup.html
  - Detects submission success via DOM mutation on leetcode.com
  - Sends to /api/lc-sync endpoint
```

---

### Phase 5 — Feynman 2.0 (Days 19–21)
**Goal:** The most powerful learning feature — teaching an AI tutor.

**Deliverables:**
- Concept picker → "Teach Me" mode UI
- Multi-turn chat where Claude plays a confused student asking "Why?" questions
- Session ends with mastery score + identified weak points
- Weak points auto-create targeted SRS cards
- Feynman session history

**Claude System Prompt for Feynman Mode:**
```
You are playing the role of a curious, slightly confused junior developer (age 22). 
You're trying to understand {concept_name} from the user who is teaching you.

Rules:
- Ask ONE question at a time based on what they just explained
- If something is unclear, say "Wait, I don't understand [specific part]..."
- Ask "But WHY does that happen?" when they state facts without explaining reasoning
- Ask "Can you give me a real example of that?" when things are abstract
- Ask "How is this different from [related concept]?" to test depth
- After 6-8 exchanges, evaluate their explanation.
- Return JSON at the end: {mastery_score: 0-1, strong_points: [], weak_points: [], follow_up_cards: [{front, back}]}
- NEVER just accept a vague or incomplete explanation without probing
```

**Agent Prompt:**
```
Read CLAUDE.md. Build Feynman 2.0 Mode:
1. Concept picker page /app/(dashboard)/feynman 
   (searchable list of user's AIML concepts)
2. Teaching session page: split view — concept notes (collapsed, peekable) + chat
3. API route /api/ai/feynman: streaming Claude responses, maintains conversation 
   history in session state, detects when Claude outputs final JSON evaluation
4. End-of-session screen: mastery score (animated ring), strong/weak points, 
   "Add {N} reinforcement cards to SRS" button
5. Save session to feynman_sessions table
6. Display feynman history on concept detail page
```

---

### Phase 6 — Analytics Dashboard (Days 22–25)
**Goal:** The most visually impressive part of the app.

**Deliverables:**

1. **Retention Heatmap** — GitHub-style grid. Each cell = one concept. Color = FSRS retrievability. Click → open concept.
2. **Progress Timeline** — 8-month chart showing AIML course % + DSA patterns mastered + overall retention. Target line vs actual.
3. **Pattern Mastery Breakdown** — 25 patterns with problem count, avg confidence, trend.
4. **AIML Mastery Dependency Tree** — Hierarchical visualization (D3 force graph). Color = mastery. Edge = prerequisite.
5. **Calibration Chart** — Scatter plot: predicted confidence vs actual retention rate.
6. **Study Streaks & Time** — Calendar heatmap (like GitHub contributions), daily study time bar chart.
7. **7-Day Forecast** — Bar chart showing reviews due per day for next 7 days.
8. **Pace Predictor** — "At current pace: master {X}/25 DSA patterns by month 4."

**Agent Prompt:**
```
Read CLAUDE.md. Build the Analytics Dashboard at /app/(dashboard)/analytics:
1. Retention Heatmap: Recharts grid, color scale from gray(0%) to emerald(100%),
   click handler navigates to concept
2. Progress Timeline: multi-line Recharts LineChart with AIML%, DSA%, retention%
3. Pattern Breakdown: sortable table + horizontal progress bars with color coding
4. Knowledge Graph: D3.js force-directed graph in a <canvas> element,
   nodes = concepts, edges = prerequisites, color = mastery score
5. Calibration scatter plot: Recharts ScatterChart
6. Study heatmap: D3.js calendar heatmap (Github-style, 52 weeks)
7. 7-Day forecast: BarChart from reviews table grouped by due date
8. Pace predictor: calculate from current rate of completion
All charts should animate on mount using Framer Motion + Recharts animation props.
```

---

### Phase 7 — Knowledge Graph & Semantic Search (Days 26–28)
**Goal:** Cross-domain connections and semantic similarity.

**Deliverables:**
- Supabase Edge Function: on concept/problem create → generate OpenAI embedding → store in `concept_embeddings`
- Semantic search bar (searches concepts AND problems by meaning, not just text)
- "Related Concepts" panel on every concept page (top 5 by cosine similarity)
- **Cross-Domain Connection Discovery** (weekly Edge Function):
  - Find AIML concepts and DSA patterns with high semantic similarity
  - Claude explains the connection in 2-3 sentences
  - Displayed as "Insight Cards" on the dashboard
- Cascade Mastery: Supabase RPC function that walks the prerequisite graph

**Agent Prompt:**
```
Read CLAUDE.md. Build the Knowledge Graph features:
1. Supabase Edge Function /functions/generate-embedding:
   - Called after concept/problem creation
   - Generates OpenAI embedding (text-embedding-3-small)
   - Stores in concept_embeddings with content_hash for deduplication
2. Supabase RPC function match_concepts(query_embedding, match_count):
   returns top-N similar concepts using cosine similarity on pgvector
3. Semantic search API route /api/search: generates embedding for query, 
   calls match_concepts RPC, returns ranked results
4. "Related Concepts" sidebar panel on concept detail page
5. Cross-connection discovery Edge Function /functions/discover-connections:
   - Finds AIML-DSA pairs with cosine similarity > 0.7
   - Sends pairs to Claude to explain the connection
   - Stores results in weekly_syntheses.cross_connections
6. Cascade mastery RPC: calculate_mastery(concept_id) that averages direct 
   SRS retention + weighted prerequisite mastery scores
```

---

### Phase 8 — Accountability Engine (Days 29–31)
**Goal:** The system keeps you showing up.

**Deliverables:**
- Morning check-in flow (opens on first visit after 6am)
- Streak tracking with grace days (1/week auto-consumed)
- Weekly Review ritual UI (5-step guided Sunday flow)
- Commitment contract: set weekly goal, displayed with compliance tracker
- Weekly Synthesis auto-generated every Sunday morning
- Email notifications via Supabase + Resend (free tier)

**Agent Prompt:**
```
Read CLAUDE.md. Build the Accountability Engine:
1. Streak service in /lib/streak.ts: updateStreak(), consumeGraceDay(), 
   getStreakStatus() — pure functions, called from API routes
2. Morning check-in modal: appears if no session started today after 6am.
   Shows: today's plan, streak status, "Begin Session" button
3. Weekly review ritual /app/(dashboard)/weekly-review:
   5-step wizard with Framer Motion slide transitions
   Step 1: Week stats (auto-populated from DB)
   Step 2: Rate each AIML concept covered this week (slider 1-5)
   Step 3: Identify 1 weak area (dropdown from their concepts)
   Step 4: Read AI-generated weekly synthesis (stream from Claude)
   Step 5: Set next week's daily goal
4. Supabase Edge Function /functions/generate-weekly-synthesis:
   Gathers week's data → sends to Claude → saves to weekly_syntheses table
5. Commitment contract widget on dashboard: shows week goal vs actual
6. Email notifications via Resend: weekly synthesis delivery on Sunday morning
```

---

### Phase 9 — PWA & Production Polish (Days 32–35)
**Goal:** Ship to production. Fast, beautiful, reliable.

**Deliverables:**
- PWA configuration (offline support, install prompt)
- Mobile-first review interface with swipe gestures (swipe left = Again, right = Easy)
- Performance: Suspense boundaries, skeleton loaders, optimistic UI on all mutations
- Production Supabase project (separate from dev)
- Vercel deployment with all env vars
- Custom domain
- `README.md` + `CLAUDE.md` finalized

**Agent Prompt:**
```
Read CLAUDE.md. Polish and deploy MasteryOS:
1. PWA: install next-pwa, configure manifest.json with app icons, 
   offline fallback page
2. Swipe gestures on review cards: use @use-gesture/react for 
   left/right swipe → map to Again/Easy ratings
3. Add loading.tsx to all route segments (Suspense boundaries)
4. Implement optimistic updates on SRS review mutations
5. Mobile-responsive audit: test all pages at 375px width, fix any overflow
6. Add meta tags, og:image, structured data to all pages
7. Production checklist: 
   - Supabase prod project created + schema applied
   - RLS policies verified on all tables
   - Vercel project connected to GitHub, env vars set
   - Custom domain configured
   - Lighthouse score >90 on performance + accessibility
```

---

## Part 8 — CLAUDE.md (Root File for Code Agent)

```markdown
# MasteryOS — Claude Code Context

## Project
AI-Powered Learning OS for AIML + DSA mastery. 
Stack: Next.js 15, TypeScript, Supabase, ts-fsrs, Anthropic Claude API.

## Tech Stack
- Frontend + API: Next.js 15 (App Router), TypeScript, Tailwind CSS, Shadcn/UI
- Database: Supabase (PostgreSQL + pgvector + Auth + Storage + Edge Functions)
- SRS: ts-fsrs (TypeScript, runs in Next.js API routes - no microservice)
- AI: Anthropic Claude API (claude-sonnet-4-5)
- Embeddings: OpenAI text-embedding-3-small (via Supabase Edge Functions only)
- State: Zustand (client), TanStack Query v5 (server)
- Animation: Framer Motion
- Rich text: Tiptap
- Charts: Recharts + D3.js

## Project Structure
/app                         # Next.js App Router pages
  /(auth)                    # login, signup
  /(dashboard)               # protected pages
    /page.tsx                # AI Mentor home
    /aiml/                   # AIML Track
    /dsa/                    # DSA Track
    /review/                 # SRS Review session
    /feynman/                # Feynman 2.0 teaching mode
    /analytics/              # Analytics dashboard
    /weekly-review/          # Sunday ritual
/app/api/                    # API routes
  /review/                   # SRS review endpoint (ts-fsrs here)
  /ai/mentor/                # Mentor chat
  /ai/feynman/               # Feynman session
  /ai/quiz/                  # Quiz generation
  /ai/connections/           # Cross-domain connections
  /lc-sync/                  # LeetCode Chrome Extension endpoint
  /aiml/concepts/            # Concept CRUD
  /dsa/problems/             # Problem CRUD
/components/ui/              # Shadcn auto-generated components
/components/app/             # App-specific components
/lib/
  /supabase/                 # Supabase client (client.ts, server.ts, admin.ts)
  /fsrs.ts                   # ts-fsrs wrapper
  /claude.ts                 # Anthropic API helper with error handling
  /streak.ts                 # Streak calculation utilities
/supabase/
  /functions/                # Supabase Edge Functions (Deno)
  /migrations/               # SQL migration files
  /schema.sql                # Full schema
/types/
  /database.ts               # Generated Supabase types (supabase gen types typescript)
  /app.ts                    # App-specific TypeScript types
/chrome-extension/           # LeetCode Chrome Extension

## Conventions
- ALL DB queries: Supabase client only, never raw SQL from Next.js
- ALL AI calls: server-side only (API routes or Edge Functions), never from browser
- ALL FSRS logic: use ts-fsrs library, never implement manually
- TypeScript strict mode, no `any` types
- Components: server components by default, 'use client' only when interactive
- Error handling: all async operations return {data, error} tuples
- Optimistic updates: all mutations (reviews, logs) use TanStack Query optimistic
- Regenerate DB types: `supabase gen types typescript --local > types/database.ts`

## Design System
- Background: #0a0f1e (deep navy)
- Surface: #111827 (card backgrounds)  
- Border: #1f2937
- Primary: #7c3aed (violet)
- Success: #10b981 (emerald)
- Warning: #f59e0b (amber)
- Error: #ef4444 (red)
- Text Primary: #f9fafb
- Text Secondary: #9ca3af
- Font: Inter (next/font/google)

## Critical Rules
- NEVER call Anthropic API from client components
- NEVER expose Supabase service role key to frontend
- NEVER implement FSRS manually — always use ts-fsrs
- NEVER store sensitive data in Zustand (use Supabase session)
- DSA track: track problems only, NO code execution, no Judge0
```

---

## Part 9 — Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# AI
ANTHROPIC_API_KEY=

# Embeddings (used only in Edge Functions)
OPENAI_API_KEY=

# Email (Resend - free tier)
RESEND_API_KEY=

# Chrome Extension shared secret
LC_SYNC_SECRET=
```

---

## Part 10 — Deployment Checklist

| Step | Action | Platform |
|------|--------|---------|
| 1 | Create Supabase prod project | supabase.com |
| 2 | Apply schema to prod | Supabase Studio SQL editor |
| 3 | Enable pgvector + pg_cron extensions | Supabase Extensions tab |
| 4 | Push to GitHub | GitHub |
| 5 | Connect Vercel to GitHub | vercel.com |
| 6 | Set all env vars in Vercel | Vercel dashboard |
| 7 | Deploy Edge Functions | `supabase functions deploy` |
| 8 | Schedule pg_cron jobs | Supabase SQL editor |
| 9 | Configure custom domain | Vercel + Namecheap |
| 10 | Install Chrome Extension locally | chrome://extensions → Load unpacked |
| 11 | Run Lighthouse audit | Chrome DevTools |

---

## Decisions Locked ✅

| Question | Decision |
|----------|----------|
| Authentication | Email/password **+** Google OAuth |
| Curriculum structure | User-configurable — no pre-seeded IIT schedule |
| Chrome Extension | Local only (Load Unpacked) — no Web Store |
| Mobile | PWA only — no React Native |

> [!NOTE]
> **Multi-user**: The architecture supports it fully (RLS on all tables). If you ever want to open this to others, zero schema changes needed.
```
