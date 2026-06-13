# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project

MasteryOS — an AI-powered learning OS for DSA + AI/ML mastery. Single Next.js repo (App Router) with Supabase as the full backend (PostgreSQL + pgvector + Auth + Edge Functions).

## Commands

```bash
npm run dev      # start dev server (localhost:3000)
npm run build    # production build
npm run lint     # ESLint
```

No test suite is configured. Verify changes by running the dev server.

## Architecture

### Route structure

All authenticated pages live under `app/(dashboard)/` with a shared layout that enforces auth and prefetches per-request data (streak, due card count, daily plan). Unauthenticated routes (`/login`, `/signup`) are outside the group.

API routes are under `app/api/` and are server-only — all AI and DB calls happen here, never in client components.

### Data flow

- **Server components** fetch data directly via `lib/supabase/server.ts` (`createClient()` uses `cookies()` from `next/headers`)
- **Client components** call API routes via TanStack Query (staleTime: 60s, no refetch on focus)
- **Mutations** use TanStack Query mutations with optimistic updates
- **AI responses** stream from API routes to client via `ReadableStream` / `TransformStream`

### Key libraries

| Purpose | Library | Entry point |
|---------|---------|-------------|
| Spaced repetition | `ts-fsrs` | `lib/fsrs.ts` |
| AI (chat, Feynman, mentor) | OpenAI SDK (`gpt-5.4`) | `lib/openai.ts` |
| Embeddings + semantic search | OpenAI (`text-embedding-3-small`, 1536 dims) | `lib/openai.ts` → `generateEmbedding()` |
| Database | Supabase JS v2 | `lib/supabase/{client,server,admin}.ts` |
| Animations | Framer Motion | direct import |
| Charts | Recharts + D3.js | `components/app/analytics/` |
| UI primitives | Shadcn/UI (Base UI) + `components/ui/` | auto-generated |

### FSRS integration

`lib/fsrs.ts` wraps `ts-fsrs`. The DB stores state as lowercase text (`new`, `learning`, `review`, `relearning`) while ts-fsrs uses numeric enums — `dbCardToFSRS()` and `fsrsCardToDB()` handle conversion. Never implement FSRS logic manually; always use the library.

### Supabase clients

- `lib/supabase/server.ts` — for Server Components and API routes (uses cookies)
- `lib/supabase/client.ts` — for Client Components only
- `lib/supabase/admin.ts` — service role, for privileged operations only

### Key database tables

`srs_cards` + `reviews` — append-only review log, card state updated on each review  
`aiml_concepts` — stores `prerequisites uuid[]` for the dependency graph  
`dsa_problems` — `patterns text[]` references the 25 pre-defined patterns in `lib/constants.ts`  
`concept_embeddings` — pgvector table (1536-dim) with HNSW index for cosine similarity  
`daily_plans` — one row per user per day, contains `mentor_message` and `generated_plan` jsonb  
`feynman_sessions` — stores full conversation history as jsonb  
All tables have RLS enabled; every query must use the authenticated client.

## Conventions

- **No AI calls from the browser.** All OpenAI/AI calls are server-side only (API routes).
- **No raw SQL from Next.js.** Use the Supabase JS client exclusively.
- **Server components by default.** Add `"use client"` only when interactivity requires it.
- **All async helpers return `{ data, error }` tuples** (see `lib/openai.ts` for the pattern).
- TypeScript strict mode; avoid `any`.
- Regenerate DB types: `supabase gen types typescript --local > types/database.ts`

## Design system

Dark mode only. CSS variables defined in `app/globals.css`.

| Token | Value |
|-------|-------|
| Background | `#0a0f1e` (deep navy) |
| Surface / cards | `#111827` |
| Border | `#1f2937` |
| Primary | `#7c3aed` (violet) |
| Success | `#10b981` (emerald) |
| Warning | `#f59e0b` (amber) |
| Error | `#ef4444` |

## Environment variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
OPENAI_API_KEY
ANTHROPIC_API_KEY   # reserved for future use; current AI calls use OpenAI
```
