/**
 * Interview Mode — deterministic concept selection + scoring engine (AIML only).
 *
 * Selection runs ONCE at session start (server-side) and is cached on
 * interview_sessions.question_plan as a CONCEPT AGENDA. The interviewer then
 * drills each concept adaptively over several turns (see buildPlanContext); the
 * grade route advances current_slot one concept at a time.
 *
 * Three interleaved buckets, ramped easy → hard:
 *   this_week — concepts learned this week (created or card_status='learned' this
 *               week, or surfaced by a lecture attended this week)
 *   weak      — OLDER concepts whose min card retrievability is below threshold
 *   mixed     — OLDER, not-weak concepts, sampled weighted by graph centrality
 *
 * No DSA coupling: there is no programming slot and no pattern_mastery /
 * dsa_problems read. If a concept genuinely involves an algorithm, the
 * interviewer decides on its own whether to ask the candidate to implement or
 * derive it (prompt-driven, optional).
 *
 * Feedback is "shadow-score only": grading EMA-blends aiml_concepts.mastery_score
 * and seeds follow-up cards, but never writes a reviews row, moves srs_cards.due,
 * or mutates pattern_mastery (see app/api/interview/grade/route.ts).
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { getWeekStartISO, parseSettings } from "@/lib/accountability";
import { computeCentrality } from "@/lib/concept-graph";
import { dbCardToFSRS, getRetrievability } from "@/lib/fsrs";
import type { Tables } from "@/types/database";

// ─── Types ───────────────────────────────────────────────────────────────────

export type InterviewBucket = "this_week" | "mixed" | "weak";
export type DifficultyBand = "easy" | "medium" | "hard";

/** A single concept on the interview agenda. Stored in question_plan jsonb. */
export interface InterviewSlot {
  slotIndex: number;
  conceptId: string;
  title: string;
  /** Reference material to judge answers — SERVER-ONLY, never sent to the client. */
  notes: string;
  /** aiml_concepts.concept_type hint (e.g. 'theory' | 'math' | 'implementation'). */
  conceptType: string | null;
  bucket: InterviewBucket;
  difficultyBand: DifficultyBand;
  /** Monotonic 1..5 across the ordered plan. */
  targetDifficulty: number;
  /** The concept's reviewed card ids (informational; shadow grading doesn't review them). */
  cardIds: string[];
}

/** Client-safe projection of a slot — excludes the answer `notes` and card ids. */
export interface SlotMeta {
  slotIndex: number;
  title: string;
  bucket: InterviewBucket;
  difficultyBand: DifficultyBand;
  targetDifficulty: number;
}

/** An applied per-concept grade, appended to interview_sessions.grades. */
export interface AppliedGrade {
  slot_index: number;
  concept_id: string | null;
  slot_grade: number;
  strong_points: string[];
  weak_points: string[];
  applied: boolean;
}

type ConceptRow = Pick<
  Tables<"aiml_concepts">,
  | "id"
  | "title"
  | "notes"
  | "concept_type"
  | "mastery_score"
  | "centrality"
  | "prerequisites"
  | "created_at"
  | "card_status"
  | "card_status_updated_at"
>;

type ConceptCardRow = Pick<
  Tables<"srs_cards">,
  | "id"
  | "source_id"
  | "stability"
  | "difficulty"
  | "elapsed_days"
  | "scheduled_days"
  | "reps"
  | "lapses"
  | "state"
  | "last_review"
  | "due"
>;

// ─── Small pure helpers ──────────────────────────────────────────────────────

const DEFAULT_WEAKNESS_THRESHOLD = 0.85;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** weakness_threshold from users.settings; falls back to 0.85 if unset/invalid. */
function resolveThreshold(settings: ReturnType<typeof parseSettings>): number {
  const raw = (settings as { weakness_threshold?: unknown }).weakness_threshold;
  return typeof raw === "number" && raw > 0 && raw <= 1 ? raw : DEFAULT_WEAKNESS_THRESHOLD;
}

/** Clamp/validate a model-emitted slot grade to an integer in 1..4, or null. */
export function normalizeSlotGrade(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(4, Math.round(n)));
}

/** EMA-blend a concept's mastery_score toward the latest interview grade. Never clobbers. */
export function emaMastery(oldScore: number | null, slotGrade: number): number {
  const old = clamp01(oldScore ?? 0);
  const normalized = clamp01(slotGrade / 4);
  return clamp01(0.6 * normalized + 0.4 * old);
}

function bandFromDifficulty(target: number): DifficultyBand {
  if (target <= 2) return "easy";
  if (target <= 3) return "medium";
  return "hard";
}

/** Client-safe projection — strips answer notes and card ids. */
export function toSlotMeta(plan: InterviewSlot[]): SlotMeta[] {
  return plan.map((s) => ({
    slotIndex: s.slotIndex,
    title: s.title,
    bucket: s.bucket,
    difficultyBand: s.difficultyBand,
    targetDifficulty: s.targetDifficulty,
  }));
}

// ─── Candidate scoring ───────────────────────────────────────────────────────

interface Candidate {
  conceptId: string;
  title: string;
  notes: string;
  conceptType: string | null;
  bucket: InterviewBucket;
  /** Estimated current strength 0..1 (retrievability for studied, mastery fallback otherwise). */
  strength: number;
  priority: number;
  cardIds: string[];
}

/**
 * Per-concept strength from FSRS — replicates the readiness override verbatim:
 * only cards that have actually been reviewed count; a concept with only
 * unreviewed seed cards is "unstudied" (hasReviewed=false), NOT weak.
 */
function conceptStrength(
  conceptId: string,
  masteryScore: number | null,
  cardsByConceptId: Map<string, ConceptCardRow[]>
): { strength: number; hasReviewed: boolean; cardIds: string[] } {
  const cards = cardsByConceptId.get(conceptId) ?? [];
  const reviewed = cards.filter((c) => c.state !== "new" && (c.reps ?? 0) > 0);
  if (reviewed.length === 0) {
    // Unstudied: fall back to Feynman mastery, or a neutral 0.5 if never graded.
    return { strength: clamp01(masteryScore ?? 0.5), hasReviewed: false, cardIds: [] };
  }
  // MIN retrievability across reviewed cards — the weakest card defines the concept.
  let minR = 1;
  for (const card of reviewed) {
    const r = getRetrievability(dbCardToFSRS(card));
    if (r < minR) minR = r;
  }
  return { strength: clamp01(minR), hasReviewed: true, cardIds: reviewed.map((c) => c.id) };
}

/** Priority = 0.34·recency + 0.40·weakness + 0.26·spacingValue (peaks at R≈0.68). */
function priorityOf(bucket: InterviewBucket, strength: number): number {
  const recencyFlag = bucket === "this_week" ? 1 : 0;
  const weakness = clamp01(1 - strength);
  const spacingValue = clamp01(1 - Math.abs(strength - 0.68) / 0.68);
  return 0.34 * recencyFlag + 0.4 * weakness + 0.26 * spacingValue;
}

// ─── Slot allocation across buckets ──────────────────────────────────────────

const BUCKET_WEIGHTS: Record<InterviewBucket, number> = {
  this_week: 0.4,
  weak: 0.35,
  mixed: 0.25,
};

/**
 * Greedily allocate `total` slots across buckets by target weight, capped at each
 * bucket's availability, redistributing any remainder to non-empty buckets
 * (mirrors the zone-redistribution rule). Deterministic.
 */
function allocateSlots(
  available: Record<InterviewBucket, number>,
  total: number
): Record<InterviewBucket, number> {
  const result: Record<InterviewBucket, number> = { this_week: 0, weak: 0, mixed: 0 };
  const order: InterviewBucket[] = ["this_week", "weak", "mixed"];
  let remaining = Math.min(
    total,
    available.this_week + available.weak + available.mixed
  );

  while (remaining > 0) {
    const activeBuckets = order.filter((b) => available[b] - result[b] > 0);
    if (activeBuckets.length === 0) break;
    const weightSum = activeBuckets.reduce((s, b) => s + BUCKET_WEIGHTS[b], 0);
    let assigned = 0;
    for (const b of activeBuckets) {
      if (remaining - assigned <= 0) break;
      const want = Math.max(1, Math.round((remaining * BUCKET_WEIGHTS[b]) / weightSum));
      const give = Math.min(want, available[b] - result[b], remaining - assigned);
      result[b] += give;
      assigned += give;
    }
    remaining -= assigned;
    if (assigned === 0) break; // safety against non-termination
  }
  return result;
}

// ─── Ordering: ascending ramp + anti-adjacency interleave ────────────────────

/**
 * Stable reorder of a difficulty-sorted list so that no two consecutive slots
 * share a bucket when avoidable — preserving the easy→hard ramp as much as
 * possible (greedy: always take the earliest remaining item of a different
 * bucket than the last placed).
 */
function interleaveByBucket<T extends { bucket: InterviewBucket }>(sorted: T[]): T[] {
  const pool = [...sorted];
  const out: T[] = [];
  while (pool.length > 0) {
    const prev = out.length > 0 ? out[out.length - 1].bucket : null;
    let idx = pool.findIndex((s) => s.bucket !== prev);
    if (idx === -1) idx = 0;
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

// ─── Main entry: build the concept agenda ────────────────────────────────────

/**
 * Build the ordered concept agenda for a new interview. Returns an empty array
 * (data: []) when there is not enough material yet — the route then shows a
 * "learn something first" empty state rather than starting a session.
 *
 * Deep-over-broad: defaults to ~5 concepts (clamped 4–6); the interviewer drills
 * each one across several adaptive turns.
 */
export async function selectQuestionPlan(
  supabase: SupabaseClient,
  userId: string,
  length = 5
): Promise<{ data: InterviewSlot[] | null; error: string | null }> {
  try {
    const weekStart = getWeekStartISO();

    const [conceptsRes, cardsRes, lecturesRes, userRes] = await Promise.all([
      supabase
        .from("aiml_concepts")
        .select(
          "id,title,notes,concept_type,mastery_score,centrality,prerequisites,created_at,card_status,card_status_updated_at"
        )
        .eq("user_id", userId),
      supabase
        .from("srs_cards")
        .select(
          "id,source_id,stability,difficulty,elapsed_days,scheduled_days,reps,lapses,state,last_review,due"
        )
        .eq("user_id", userId)
        .eq("source_type", "aiml_concept"),
      supabase
        .from("lecture_schedules")
        .select("extracted_concept_ids")
        .eq("user_id", userId)
        .eq("is_attended", true)
        .gte("updated_at", weekStart),
      supabase.from("users").select("settings").eq("id", userId).single(),
    ]);

    if (conceptsRes.error) return { data: null, error: conceptsRes.error.message };

    const allConcepts = (conceptsRes.data ?? []) as ConceptRow[];
    const cards = (cardsRes.data ?? []) as ConceptCardRow[];
    const settings = parseSettings(userRes.data?.settings);
    const threshold = resolveThreshold(settings);

    // Concepts surfaced by lectures attended this week.
    const lectureConceptIds = new Set<string>();
    for (const row of lecturesRes.data ?? []) {
      for (const id of (row.extracted_concept_ids as string[] | null) ?? []) {
        lectureConceptIds.add(id);
      }
    }

    // Index cards by concept and precompute centrality.
    const cardsByConceptId = new Map<string, ConceptCardRow[]>();
    for (const card of cards) {
      const list = cardsByConceptId.get(card.source_id) ?? [];
      list.push(card);
      cardsByConceptId.set(card.source_id, list);
    }
    const centralityMap = computeCentrality(allConcepts);

    // ── Bucket every concept (disjoint; precedence this_week > weak > mixed) ──
    const candidates: Candidate[] = [];
    for (const c of allConcepts) {
      const createdThisWeek = c.created_at >= weekStart;
      const learnedThisWeek =
        c.card_status === "learned" &&
        !!c.card_status_updated_at &&
        c.card_status_updated_at >= weekStart;
      const fromLecture = lectureConceptIds.has(c.id);
      const isThisWeek = createdThisWeek || learnedThisWeek || fromLecture;

      const { strength, hasReviewed, cardIds } = conceptStrength(
        c.id,
        c.mastery_score,
        cardsByConceptId
      );

      let bucket: InterviewBucket;
      if (isThisWeek) {
        bucket = "this_week";
      } else if (hasReviewed && strength < threshold) {
        bucket = "weak";
      } else {
        bucket = "mixed";
      }

      candidates.push({
        conceptId: c.id,
        title: c.title,
        notes: c.notes ?? "",
        conceptType: c.concept_type ?? null,
        bucket,
        strength,
        priority: priorityOf(bucket, strength),
        cardIds,
      });
    }

    // Centrality-bias the mixed bucket so structurally important concepts recur.
    for (const cand of candidates) {
      if (cand.bucket === "mixed") {
        const central = centralityMap.get(cand.conceptId) ?? 0;
        cand.priority += 0.3 * central;
      }
    }

    const byBucket: Record<InterviewBucket, Candidate[]> = {
      this_week: [],
      weak: [],
      mixed: [],
    };
    for (const cand of candidates) byBucket[cand.bucket].push(cand);
    (Object.keys(byBucket) as InterviewBucket[]).forEach((b) =>
      byBucket[b].sort((x, y) => y.priority - x.priority)
    );

    // ── Capacity: deep-over-broad, ~5 concepts (clamp 4–6) ──
    const targetTotal = Math.max(4, Math.min(6, Math.round(length)));
    const available: Record<InterviewBucket, number> = {
      this_week: byBucket.this_week.length,
      weak: byBucket.weak.length,
      mixed: byBucket.mixed.length,
    };
    const alloc = allocateSlots(available, targetTotal);

    const chosen: Candidate[] = [
      ...byBucket.this_week.slice(0, alloc.this_week),
      ...byBucket.weak.slice(0, alloc.weak),
      ...byBucket.mixed.slice(0, alloc.mixed),
    ];

    if (chosen.length === 0) {
      return { data: [], error: null }; // nothing to interview on yet
    }

    // ── Ramp (ascending difficulty = weakness) then anti-adjacency interleave ──
    interface PreSlot {
      bucket: InterviewBucket;
      difficultyKey: number;
      conceptId: string;
      title: string;
      notes: string;
      conceptType: string | null;
      cardIds: string[];
    }

    const preSlots: PreSlot[] = chosen.map((c) => ({
      bucket: c.bucket,
      difficultyKey: clamp01(1 - c.strength), // weakness: strong first, weak last
      conceptId: c.conceptId,
      title: c.title,
      notes: c.notes,
      conceptType: c.conceptType,
      cardIds: c.cardIds,
    }));

    preSlots.sort((a, b) => a.difficultyKey - b.difficultyKey);
    const ordered = interleaveByBucket(preSlots);

    const n = ordered.length;
    const plan: InterviewSlot[] = ordered.map((s, i) => {
      const targetDifficulty =
        n === 1 ? 3 : Math.max(1, Math.min(5, Math.round(1 + (4 * i) / (n - 1))));
      return {
        slotIndex: i,
        conceptId: s.conceptId,
        title: s.title,
        notes: s.notes,
        conceptType: s.conceptType,
        bucket: s.bucket,
        difficultyBand: bandFromDifficulty(targetDifficulty),
        targetDifficulty,
        cardIds: s.cardIds,
      };
    });

    return { data: plan, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { data: null, error: message };
  }
}

// ─── Interviewer prompt (the adaptive, drilling interviewer) ─────────────────

const INTERVIEW_PERSONA = `You are a senior AI/ML interviewer conducting a realistic, conversational technical interview. This is NOT a quiz or trivia round — you probe to find the true depth and the edges of the candidate's understanding, exactly like a real interviewer. The candidate learns by explaining and defending their reasoning out loud, so make them actually think.

YOUR METHOD — the funnel (this is the most important part):
- Open each concept with ONE clear, fairly broad question.
- Then LISTEN to their actual answer and DRILL DOWN with adaptive follow-ups that build on what they JUST said — never a canned, pre-scripted next question.
    • If they answer well: push deeper — ask "why does that work?", request a derivation, a concrete example, an edge case, a failure mode, a trade-off versus an alternative, or "what would change if …?".
    • If they're vague, hand-wavy, or use jargon without substance: zero in on the exact gap — ask for a precise definition, a from-first-principles explanation, or a concrete worked example.
    • If they say something wrong or misuse a term: surface it gently and let them correct themselves.
- Stay on the SAME concept and keep drilling — usually 3 to 5 exchanges — until you can fairly judge how deeply they truly understand it. Do NOT accept the first surface-level answer; do NOT belabor a concept once its depth is clear.
- ONE question per turn. Keep your turns short and human (2–4 sentences). Be warm and encouraging, but intellectually honest — never praise a weak answer or pretend a gap isn't there.

ALGORITHM / IMPLEMENTATION (use judgement — NOT every concept, NOT every session):
- Only when the CURRENT concept genuinely involves an algorithm, a derivation, or a step-by-step procedure — and especially if it is a concept from a PRIOR week worth consolidating — you MAY ask the candidate to sketch it, write pseudocode/code, derive it, or walk through its steps and complexity.
- Decide this intelligently from the concept itself; most concepts will NOT need it. NEVER invent DSA / leetcode-style puzzles that aren't grounded in the candidate's own concept.

Never read the reference notes aloud or reveal you have them; they exist only so you can judge correctness and ask precise follow-ups.`;

function recencyLabel(bucket: InterviewBucket): string {
  if (bucket === "this_week") return "learned this week";
  if (bucket === "weak") return "from a prior week · flagged weak";
  return "from a prior week";
}

/**
 * Build the authoritative system prompt for a chat turn. Includes the concept
 * agenda, the current concept focus + its reference notes, and the drilling +
 * grading discipline. Called server-side each turn; current_slot stays fixed
 * while the interviewer drills, and advances only when a grade JSON is emitted.
 */
export function buildPlanContext(plan: InterviewSlot[], currentSlot: number): string {
  const total = plan.length;
  const idx = Math.max(0, Math.min(currentSlot, total - 1));
  const isLast = idx >= total - 1;
  const slot = plan[idx];

  const agenda = plan
    .map(
      (s) =>
        `  ${s.slotIndex}. [${recencyLabel(s.bucket)} · ${s.difficultyBand}] ${s.title}`
    )
    .join("\n");

  const typeHint = slot.conceptType ? ` · type: ${slot.conceptType}` : "";
  const reference = slot.notes?.trim()
    ? `Reference for this concept (FOR YOUR JUDGEMENT ONLY — never read aloud):\n"""${slot.notes.slice(0, 1800)}"""`
    : `No reference notes for this concept; judge from your own expertise.`;

  const nextInstruction = isLast
    ? `This was the FINAL concept — do NOT open another. After the grade JSON, emit the final scorecard JSON block and warmly close the interview.`
    : `Then naturally transition and open concept ${idx + 1} ("${plan[idx + 1].title}") with your first, fairly broad question.`;

  return `${INTERVIEW_PERSONA}

CONCEPT AGENDA (${total} concepts, ramped easier → harder — cover them in order):
${agenda}

You are CURRENTLY interviewing on concept ${idx} of ${total}: "${slot.title}"  [${recencyLabel(slot.bucket)} · ${slot.difficultyBand}${typeHint}].
${reference}

DRILLING + GRADING DISCIPLINE:
- Drill THIS concept with adaptive follow-ups (your funnel method) across multiple turns. Do NOT output any JSON while you are still probing.
- ONLY once you have genuinely assessed the candidate's depth on concept ${idx} (typically after 3–5 exchanges):
   1. Give one sentence of honest, specific feedback.
   2. Emit EXACTLY ONE fenced JSON block grading concept ${idx}, wrapped in \`\`\`json fences:
\`\`\`json
{"slot_index": ${idx}, "slot_grade": 3, "strong_points": ["..."], "weak_points": ["..."], "follow_up_card": {"front": "a question targeting their weakest point", "back": "the answer"}}
\`\`\`
      slot_grade: 4 = deep mastery, 3 = solid with minor gaps, 2 = shaky / major gaps, 1 = little real understanding. follow_up_card may be null.
   3. ${nextInstruction}

FINAL SCORECARD — only after the LAST concept is graded, emit a separate fenced JSON block:
\`\`\`json
{"overall_score": 0.0, "readiness_summary": "2–3 sentence honest interviewer debrief", "per_concept": [{"title": "...", "slot_grade": 3, "gap": "one concrete improvement"}], "focus_recommendation": "the single most valuable thing to study next"}
\`\`\`

Always wrap JSON in \`\`\`json fences. Emit JSON ONLY at a concept transition or for the final scorecard — NEVER mid-drill.`;
}
