// Research-paper recommender — server-side only.
//
// Turns what a user has actually learned (aiml_concepts with card_status
// seeded/learned + live FSRS recall) into real, level-aligned arXiv papers:
//
//   1. Build a learning profile (concepts + recall %).
//   2. LLM derives focused arXiv search queries from that profile.
//   3. Fetch + dedup real candidates from the arXiv API.
//   4. LLM ranks the candidates and writes a per-paper alignment rationale,
//      readiness flag, matched concepts, and informational "gap" prereqs.
//
// Results are upserted into paper_recommendations, preserving each paper's
// reading-list status (saved/read/dismissed) across regeneration.

import type { SupabaseClient } from "@supabase/supabase-js";
import { generateJSON } from "@/lib/openai";
import { dbCardToFSRS, getRetrievability } from "@/lib/fsrs";
import { searchArxiv, type ArxivPaper } from "@/lib/arxiv";

// ─── Tunables ────────────────────────────────────────────────────────────────
const MIN_LEARNED_CONCEPTS = 3;
const MAX_QUERIES = 5;
const RESULTS_PER_QUERY = 6;
const MAX_CANDIDATES = 25;
const MAX_RECOMMENDATIONS = 8;
const INTER_QUERY_DELAY_MS = 1000; // be polite to the arXiv API

// ─── Public types ────────────────────────────────────────────────────────────
export interface GapConcept {
  title: string;
  reading_suggestion: string;
}

export interface PaperRecommendation {
  id: string;
  arxiv_id: string;
  title: string;
  authors: string[];
  abstract: string | null;
  categories: string[];
  published_at: string | null;
  abs_url: string | null;
  pdf_url: string | null;
  relevance_score: number | null;
  alignment_rationale: string | null;
  readiness: "ready" | "stretch" | null;
  reading_order: number | null;
  matched_concept_ids: string[];
  matched_concept_titles: string[];
  gap_concepts: GapConcept[];
  status: "suggested" | "saved" | "read" | "dismissed";
  created_at: string;
  updated_at: string;
}

export type RecommendOutcome =
  | { status: "ok"; recommendations: PaperRecommendation[] }
  | { status: "insufficient"; learnedCount: number };

// ─── Internal types ──────────────────────────────────────────────────────────
interface LearnedConcept {
  id: string;
  title: string;
  type: string | null;
  tags: string[];
  recall: number; // 0..1
}

type ConceptRow = {
  id: string;
  title: string;
  concept_type: string | null;
  tags: string[] | null;
  card_status: string | null;
  mastery_score: number | null;
};

type CardRow = {
  source_id: string;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: string;
  last_review: string | null;
};

// ─── Small helpers ───────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function clamp01(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
}

function sanitizeGaps(value: unknown): GapConcept[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((g) => {
    if (!g || typeof g !== "object") return [];
    const obj = g as Record<string, unknown>;
    if (typeof obj.title !== "string" || obj.title.trim().length === 0) return [];
    return [
      {
        title: obj.title.trim(),
        reading_suggestion:
          typeof obj.reading_suggestion === "string" ? obj.reading_suggestion.trim() : "",
      },
    ];
  });
}

// ─── Step 1: learning profile ────────────────────────────────────────────────
async function buildLearningProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<LearnedConcept[]> {
  const { data: conceptData } = await supabase
    .from("aiml_concepts")
    .select("id, title, concept_type, tags, card_status, mastery_score")
    .eq("user_id", userId)
    .in("card_status", ["seeded", "learned"]);

  const concepts = (conceptData ?? []) as ConceptRow[];
  if (concepts.length === 0) return [];

  const conceptIds = concepts.map((c) => c.id);
  const { data: cardData } = await supabase
    .from("srs_cards")
    .select(
      "source_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review"
    )
    .eq("user_id", userId)
    .eq("source_type", "aiml_concept")
    .in("source_id", conceptIds);

  // Mean FSRS retrievability per concept.
  const recallSum = new Map<string, { total: number; n: number }>();
  for (const card of (cardData ?? []) as CardRow[]) {
    const r = getRetrievability(dbCardToFSRS(card));
    const acc = recallSum.get(card.source_id) ?? { total: 0, n: 0 };
    acc.total += r;
    acc.n += 1;
    recallSum.set(card.source_id, acc);
  }

  return concepts.map((c) => {
    const acc = recallSum.get(c.id);
    const recall = acc && acc.n > 0 ? acc.total / acc.n : c.mastery_score ?? 0;
    return {
      id: c.id,
      title: c.title,
      type: c.concept_type,
      tags: c.tags ?? [],
      recall,
    };
  });
}

function renderProfile(learned: LearnedConcept[]): string {
  return learned
    .slice()
    .sort((a, b) => b.recall - a.recall)
    .map((c) => {
      const tags = c.tags.length ? ` [${c.tags.join(", ")}]` : "";
      const type = c.type ? ` (${c.type})` : "";
      return `- ${c.title}${type}${tags} — recall ${Math.round(c.recall * 100)}%`;
    })
    .join("\n");
}

// ─── Step 2: derive arXiv queries ────────────────────────────────────────────
async function deriveQueries(profileText: string): Promise<string[]> {
  const system =
    "You are a research librarian helping an AI/ML learner find papers matched to " +
    "what they already understand. Given the learner's mastered concepts, propose " +
    "focused arXiv search queries (2–5 words each) that surface papers they could " +
    "realistically read now. Prefer canonical and well-cited topics over obscure ones.";
  const user =
    `The learner has mastered these concepts (with recall %):\n${profileText}\n\n` +
    `Return JSON: { "queries": string[] } with ${MAX_QUERIES} short arXiv search ` +
    `queries spanning their strongest areas. No author names, no years.`;

  const { data } = await generateJSON<{ queries?: unknown }>(system, user, 600, "gpt-4o-mini");
  return asStringArray(data?.queries).slice(0, MAX_QUERIES);
}

// ─── Step 3: fetch candidate papers ──────────────────────────────────────────
async function fetchCandidates(queries: string[]): Promise<ArxivPaper[]> {
  const byId = new Map<string, ArxivPaper>();
  for (let i = 0; i < queries.length; i++) {
    const { data } = await searchArxiv(queries[i], RESULTS_PER_QUERY);
    for (const paper of data ?? []) {
      if (!byId.has(paper.arxivId)) byId.set(paper.arxivId, paper);
    }
    if (i < queries.length - 1) await sleep(INTER_QUERY_DELAY_MS);
  }
  return Array.from(byId.values()).slice(0, MAX_CANDIDATES);
}

// ─── Step 4: rank & align ────────────────────────────────────────────────────
interface RawSelection {
  index?: unknown;
  relevance_score?: unknown;
  readiness?: unknown;
  alignment_rationale?: unknown;
  matched_concept_titles?: unknown;
  gap_concepts?: unknown;
  reading_order?: unknown;
}

async function rankCandidates(
  profileText: string,
  candidates: ArxivPaper[]
): Promise<RawSelection[]> {
  const catalog = candidates
    .map(
      (p, i) =>
        `[${i}] ${p.title}\n` +
        `    categories: ${p.categories.join(", ") || "n/a"}\n` +
        `    abstract: ${p.abstract.slice(0, 600)}`
    )
    .join("\n\n");

  const system =
    "You are an expert AI/ML mentor selecting research papers for a specific learner. " +
    "Pick papers they can genuinely follow given the concepts they've mastered. Mark a " +
    "paper 'ready' if their mastered concepts cover its prerequisites, or 'stretch' if it " +
    "needs one or two concepts they haven't learned yet. For 'stretch' papers, list those " +
    "missing prerequisites as gap_concepts with a brief reading_suggestion each. Only cite " +
    "matched_concept_titles that appear verbatim in the learner's mastered list.";
  const user =
    `Learner's mastered concepts (with recall %):\n${profileText}\n\n` +
    `Candidate papers:\n${catalog}\n\n` +
    `Select up to ${MAX_RECOMMENDATIONS} papers, best fit first. Return JSON:\n` +
    `{ "selections": [ {\n` +
    `  "index": number,                       // index from the candidate list\n` +
    `  "relevance_score": number,             // 0..1 fit to this learner\n` +
    `  "readiness": "ready" | "stretch",\n` +
    `  "alignment_rationale": string,         // 1–2 sentences, reference their concepts\n` +
    `  "matched_concept_titles": string[],    // verbatim from the mastered list\n` +
    `  "gap_concepts": [ { "title": string, "reading_suggestion": string } ],\n` +
    `  "reading_order": number                // 1-based suggested order\n` +
    `} ] }`;

  const { data } = await generateJSON<{ selections?: unknown }>(system, user, 3000, "gpt-4o");
  return Array.isArray(data?.selections) ? (data.selections as RawSelection[]) : [];
}

// ─── Orchestration ───────────────────────────────────────────────────────────
export async function generateRecommendations(
  supabase: SupabaseClient,
  userId: string
): Promise<{ data: RecommendOutcome | null; error: string | null }> {
  // Step 1 — learning profile + insufficient-concept guard.
  const learned = await buildLearningProfile(supabase, userId);
  if (learned.length < MIN_LEARNED_CONCEPTS) {
    return { data: { status: "insufficient", learnedCount: learned.length }, error: null };
  }
  const profileText = renderProfile(learned);
  const titleToConcept = new Map(
    learned.map((c) => [c.title.toLowerCase(), { id: c.id, title: c.title }])
  );

  // Step 2 — derive queries (fall back to top concept titles if the LLM returns none).
  let queries = await deriveQueries(profileText);
  if (queries.length === 0) {
    queries = learned
      .slice()
      .sort((a, b) => b.recall - a.recall)
      .slice(0, MAX_QUERIES)
      .map((c) => c.title);
  }

  // Step 3 — fetch real candidates.
  const candidates = await fetchCandidates(queries);
  if (candidates.length === 0) {
    return { data: null, error: "No papers could be fetched from arXiv right now." };
  }

  // Step 4 — rank & align.
  const selections = await rankCandidates(profileText, candidates);
  if (selections.length === 0) {
    return { data: null, error: "Could not rank papers for your level right now." };
  }

  // Normalize selections → rows (dedup by index, validate bounds).
  const seenIdx = new Set<number>();
  const normalized = selections
    .map((sel) => {
      const idx = typeof sel.index === "number" ? sel.index : -1;
      if (idx < 0 || idx >= candidates.length || seenIdx.has(idx)) return null;
      seenIdx.add(idx);
      const paper = candidates[idx];
      // Resolve LLM-cited titles back to the learner's actual concepts; keep id +
      // canonical title index-aligned, deduped by id.
      const seenConcept = new Set<string>();
      const matched = asStringArray(sel.matched_concept_titles).flatMap((t) => {
        const concept = titleToConcept.get(t.toLowerCase());
        if (!concept || seenConcept.has(concept.id)) return [];
        seenConcept.add(concept.id);
        return [concept];
      });
      const readiness: "ready" | "stretch" = sel.readiness === "ready" ? "ready" : "stretch";
      return {
        paper,
        relevance_score: clamp01(sel.relevance_score),
        readiness,
        alignment_rationale:
          typeof sel.alignment_rationale === "string" ? sel.alignment_rationale.trim() : null,
        matched_concept_ids: matched.map((m) => m.id),
        matched_concept_titles: matched.map((m) => m.title),
        gap_concepts: sanitizeGaps(sel.gap_concepts),
        reading_order:
          typeof sel.reading_order === "number" ? Math.trunc(sel.reading_order) : null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, MAX_RECOMMENDATIONS);

  if (normalized.length === 0) {
    return { data: null, error: "Could not rank papers for your level right now." };
  }

  // Preserve existing reading-list status across regeneration.
  const arxivIds = normalized.map((n) => n.paper.arxivId);
  const { data: existing } = await supabase
    .from("paper_recommendations")
    .select("arxiv_id, status")
    .eq("user_id", userId)
    .in("arxiv_id", arxivIds);
  const existingStatus = new Map(
    ((existing ?? []) as { arxiv_id: string; status: string }[]).map((r) => [
      r.arxiv_id,
      r.status,
    ])
  );

  const now = new Date().toISOString();
  const rows = normalized.map((n) => ({
    user_id: userId,
    arxiv_id: n.paper.arxivId,
    title: n.paper.title,
    authors: n.paper.authors,
    abstract: n.paper.abstract || null,
    categories: n.paper.categories,
    published_at: n.paper.publishedAt,
    abs_url: n.paper.absUrl,
    pdf_url: n.paper.pdfUrl,
    relevance_score: n.relevance_score,
    alignment_rationale: n.alignment_rationale,
    readiness: n.readiness,
    reading_order: n.reading_order,
    matched_concept_ids: n.matched_concept_ids,
    matched_concept_titles: n.matched_concept_titles,
    gap_concepts: n.gap_concepts,
    status: existingStatus.get(n.paper.arxivId) ?? "suggested",
    updated_at: now,
  }));

  const { data: upserted, error: upsertError } = await supabase
    .from("paper_recommendations")
    .upsert(rows, { onConflict: "user_id,arxiv_id" })
    .select("*");

  if (upsertError) {
    return { data: null, error: upsertError.message };
  }

  return {
    data: {
      status: "ok",
      recommendations: (upserted ?? []) as unknown as PaperRecommendation[],
    },
    error: null,
  };
}
