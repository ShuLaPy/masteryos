/**
 * Mentor lecture intelligence (the "what should I focus on" brain).
 *
 * The AI mentor used to be blind to the lecture schedule: it knew SRS stats, DSA
 * patterns, and weak concepts, but nothing about upcoming lectures or whether the
 * user had actually touched their prerequisites. This module is the missing piece
 * — it joins `lecture_schedules` ⨯ `srs_cards` ⨯ `aiml_concepts` and surfaces:
 *
 *   - per upcoming lecture: readiness %, prereq coverage, and a per-prereq status
 *     (unstudied / weak / strong), computed exactly like the Schedule page's
 *     readiness widget so the numbers the mentor quotes match what the user sees;
 *   - a ranked list of the highest-leverage prerequisites to study right now,
 *     using the real Bridge & Runway priority formula (lib/planning-engine →
 *     scorePriority); and
 *   - the most-recent attended lecture's retention, so the mentor can speak to
 *     how well prior material is sticking.
 *
 * It is computed SERVER-SIDE and re-derived inside the mentor API route on every
 * request, so the AI always reasons over fresh, untampered data (the browser
 * never gets to fabricate the user's readiness).
 *
 * Memory rules mirror spec §6/§12 and the readiness route: an auto-seeded card
 * that has never been reviewed (state 'new', reps 0) represents ZERO knowledge —
 * it must not inflate readiness. A prereq counts as "studied" only once at least
 * one of its cards has actually been reviewed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatInTimeZone } from "date-fns-tz";
import { computeCentrality } from "@/lib/concept-graph";
import {
  scorePriority,
  isLectureImminent,
  DEFAULT_PRIORITY_WEIGHTS,
  type PriorityWeights,
  type SrsCard,
} from "@/lib/planning-engine";
import { dbCardToFSRS, getRetrievability } from "@/lib/fsrs";
import { estimateCardMinutes } from "@/lib/card-estimator";
import { buildDsaZones } from "@/lib/dsa-planner";
import { zpdTarget } from "@/lib/zpd";
import { effectiveRating, type GlobalSkill } from "@/lib/skill-level";
import { currentRd, weaknessFromMastery, type Difficulty } from "@/lib/pattern-rating";
import type { Database, Tables } from "@/types/database";

// ─── Types ───────────────────────────────────────────────────────────────────

type Client = SupabaseClient<Database>;

export type PrereqStatusKind = "unstudied" | "weak" | "strong";

export interface PrereqStatus {
  conceptId: string;
  title: string;
  status: PrereqStatusKind;
  /** Min retrievability across reviewed cards (0 when unstudied). */
  retrievability: number;
  /** Bridge & Runway priority score (higher = study sooner). */
  priority: number;
  cardCount: number;
  /** Estimated minutes of focused effort to work this concept's cards. */
  estimatedMinutes: number;
}

export interface UpcomingLectureIntel {
  id: string;
  title: string;
  scheduledDate: string;
  daysUntil: number;
  /** 0–1, avg-based — matches the Schedule page readiness widget. */
  readinessScore: number;
  /** 0–1, fraction of prereqs that have been studied. */
  coverage: number;
  /** Within the cold-start window (≤7 days) → prep is urgent. */
  imminent: boolean;
  prereqCount: number;
  /** Estimated minutes still needed to prepare all non-strong prereqs. */
  prepMinutesRemaining: number;
  prereqs: PrereqStatus[];
}

export interface RecentLectureIntel {
  id: string;
  title: string;
  scheduledDate: string;
  daysAgo: number;
  conceptCount: number;
  /** Avg retrievability across the lecture's reviewed concept cards (null if none). */
  avgRetrievability: number | null;
}

export interface TopPriorityAction {
  conceptTitle: string;
  lectureTitle: string;
  daysUntil: number;
  status: PrereqStatusKind;
  priority: number;
}

export interface LectureIntel {
  upcoming: UpcomingLectureIntel[];
  recentAttended: RecentLectureIntel | null;
  topPriorities: TopPriorityAction[];
}

// ─── DSA recommendation types ────────────────────────────────────────────────

/** A weak DSA pattern with its Glicko-2 rating and ZPD difficulty. */
export interface WeakPattern {
  pattern: string;
  rating: number;
  /** Weakness signal ∈ [0,1] (mastery gap or staleness). */
  weakness: number;
  /** Challenging-but-winnable difficulty for the next problem (ZPD). */
  zpd: Difficulty;
}

/** A concrete ZPD-matched problem to suggest next. */
export interface SuggestedProblem {
  title: string;
  difficulty: string;
  /** The neglected/weak pattern this problem targets. */
  pattern: string;
  url: string | null;
}

export interface DsaRecommendation {
  /** Global DSA skill: beginner/intermediate/advanced level + weighted rating. */
  globalSkill: GlobalSkill;
  /** Patterns under-practiced vs their deserved share (portfolio drift). */
  neglectedPatterns: string[];
  overPracticedPatterns: string[];
  /** 0–1; 1 = perfectly balanced practice across patterns. */
  balanceScore: number;
  /** Weakest patterns by Glicko-2 weakness signal (attempted patterns only). */
  weakestPatterns: WeakPattern[];
  /** ZPD-matched, neglected-biased problems to solve next. */
  suggestedProblems: SuggestedProblem[];
  /** Due re-solve ladder cards (spaced re-derivation of past problems). */
  dueReSolveCount: number;
  /** Due recognition-drill cards (pattern recognition reps). */
  dueRecognitionDrillCount: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const DEFAULT_WEAKNESS_THRESHOLD = 0.85; // spec §3 / AGENTS.md
/** How many upcoming un-attended lectures the mentor reasons about. */
const MAX_UPCOMING = 3;
/** Rough prep estimate for a prereq with no cards yet (will be cold-start seeded). */
const COLD_START_PREP_MINUTES = 10;

const CARD_COLUMNS =
  "id, source_id, source_type, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review";

type CardRow = Pick<
  Database["public"]["Tables"]["srs_cards"]["Row"],
  | "id"
  | "source_id"
  | "source_type"
  | "due"
  | "stability"
  | "difficulty"
  | "elapsed_days"
  | "scheduled_days"
  | "reps"
  | "lapses"
  | "state"
  | "last_review"
>;

/** Calendar-day number (UTC) for a 'YYYY-MM-DD' (or ISO) date string. */
function dayNumber(dateStr: string): number {
  const t = Date.parse(`${dateStr.substring(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? NaN : Math.floor(t / MS_PER_DAY);
}

/** Validate an IANA timezone via Intl; fall back to UTC (spec §9.4). */
function resolveTimeZone(tz: unknown): string {
  if (typeof tz === "string" && tz.length > 0) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    } catch {
      /* fall through */
    }
  }
  return "UTC";
}

/** Clamp the weakness threshold to (0, 1]; fall back to default (spec §3). */
function resolveThreshold(value: unknown): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 1
    ? value
    : DEFAULT_WEAKNESS_THRESHOLD;
}

/** Read settings.priority_weights (+ lookahead_days), falling back to defaults. */
function resolveWeights(settings: Record<string, unknown>): PriorityWeights {
  const raw = settings.priority_weights;
  const lookahead =
    typeof settings.lookahead_days === "number" &&
    Number.isFinite(settings.lookahead_days) &&
    settings.lookahead_days > 0
      ? settings.lookahead_days
      : DEFAULT_PRIORITY_WEIGHTS.lookaheadDays;

  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const { blast, centrality, proximity } = o;
    if (
      typeof blast === "number" &&
      typeof centrality === "number" &&
      typeof proximity === "number"
    ) {
      return { blast, centrality, proximity, lookaheadDays: lookahead };
    }
  }
  return { ...DEFAULT_PRIORITY_WEIGHTS, lookaheadDays: lookahead };
}

/**
 * Retrievability of a single card under the spec §6/§12 "unstudied = 0" rule:
 * a card that has never been reviewed (state 'new' or reps 0) represents zero
 * knowledge regardless of what getRetrievability() returns for a stability-0 card.
 * Mirrors the private cardRetrievability in lib/planning-engine and the inline
 * filter in /api/metrics/readiness so all three agree.
 */
function cardRetrievability(card: CardRow): number {
  if (card.state === "new" || (card.reps ?? 0) === 0) return 0;
  return getRetrievability(dbCardToFSRS(card));
}

/** Whether a card has actually been reviewed (counts toward "studied"). */
function isReviewed(card: CardRow): boolean {
  return card.state !== "new" && (card.reps ?? 0) > 0;
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Compute the mentor's lecture intelligence for one user. The caller is
 * responsible for authentication; this trusts `userId` and queries through the
 * supplied (RLS-scoped) client.
 */
export async function computeLectureIntelligence(
  supabase: Client,
  userId: string
): Promise<{ data: LectureIntel | null; error: string | null }> {
  const [profileRes, schedulesRes, cardsRes, conceptsRes] = await Promise.all([
    supabase.from("users").select("settings").eq("id", userId).single(),
    supabase
      .from("lecture_schedules")
      .select(
        "id, title, scheduled_date, week_number, is_attended, prerequisite_concept_ids, extracted_concept_ids"
      )
      .eq("user_id", userId)
      .order("scheduled_date", { ascending: true })
      .order("week_number", { ascending: true }),
    supabase
      .from("srs_cards")
      .select(CARD_COLUMNS)
      .eq("user_id", userId)
      .eq("source_type", "aiml_concept"),
    supabase
      .from("aiml_concepts")
      .select("id, title, prerequisites")
      .eq("user_id", userId),
  ]);

  const firstError =
    schedulesRes.error || cardsRes.error || conceptsRes.error;
  if (firstError) {
    return {
      data: null,
      error: `Failed to load lecture intelligence: ${firstError.message}`,
    };
  }

  const settings = ((profileRes.data?.settings ?? {}) as Record<string, unknown>);
  const timeZone = resolveTimeZone(settings.timezone);
  const today = formatInTimeZone(new Date(), timeZone, "yyyy-MM-dd");
  const todayNum = dayNumber(today);
  const threshold = resolveThreshold(settings.weakness_threshold);
  const weights = resolveWeights(settings);

  const lectures = schedulesRes.data ?? [];
  const cards = (cardsRes.data ?? []) as CardRow[];
  const concepts = conceptsRes.data ?? [];

  // Index: concept id → title, concept id → cards, graph shape, centrality.
  const titleById = new Map(concepts.map((c) => [c.id, c.title]));
  const allConcepts = concepts.map((c) => ({
    id: c.id,
    prerequisites: c.prerequisites,
  }));
  const conceptById = new Map(allConcepts.map((c) => [c.id, c]));
  const centrality = computeCentrality(allConcepts);

  const cardsByConcept = new Map<string, CardRow[]>();
  for (const card of cards) {
    const list = cardsByConcept.get(card.source_id);
    if (list) list.push(card);
    else cardsByConcept.set(card.source_id, [card]);
  }

  // ── Upcoming un-attended lectures (next N on/after today) ──────────────────
  const upcomingRaw = lectures
    .filter((l) => dayNumber(l.scheduled_date) >= todayNum && !l.is_attended)
    .slice(0, MAX_UPCOMING);

  const upcoming: UpcomingLectureIntel[] = upcomingRaw.map((lecture) => {
    const rawPrereqIds =
      (lecture.prerequisite_concept_ids as string[] | null) ?? [];
    // Only known (non-dangling) concepts get a displayable status row, but
    // readiness/coverage still divide by the RAW count so the numbers match the
    // Schedule page widget (/api/metrics/readiness counts dangling ids too).
    const prereqIds = rawPrereqIds.filter((id) => titleById.has(id));
    const daysUntil = dayNumber(lecture.scheduled_date) - todayNum;

    const prereqs: PrereqStatus[] = prereqIds.map((conceptId) => {
      const conceptCards = cardsByConcept.get(conceptId) ?? [];
      const reviewed = conceptCards.filter(isReviewed);

      let status: PrereqStatusKind;
      let minR = 0;
      if (reviewed.length === 0) {
        // Nothing ever reviewed → "unstudied" (more informative than "weak").
        status = "unstudied";
        minR = 0;
      } else {
        // Min over ALL cards (an unreviewed card scores 0), matching the
        // planner's weak/strong classifier in lib/planning-engine so the mentor
        // never labels "strong" a concept the Runway is actively remediating.
        minR = Math.min(...conceptCards.map(cardRetrievability));
        status = minR < threshold ? "weak" : "strong";
      }

      const priority = scorePriority(
        conceptById.get(conceptId) ?? { id: conceptId, prerequisites: null },
        conceptCards as SrsCard[],
        {
          id: lecture.id,
          scheduled_date: lecture.scheduled_date,
          prerequisite_concept_ids: prereqIds,
        },
        allConcepts,
        weights,
        centrality
      );

      const estimatedMinutes =
        conceptCards.length > 0
          ? Math.round(
              conceptCards.reduce(
                (s, c) => s + estimateCardMinutes(c as Tables<"srs_cards">),
                0
              )
            )
          : COLD_START_PREP_MINUTES;

      return {
        conceptId,
        title: titleById.get(conceptId) ?? "Untitled concept",
        status,
        retrievability: minR,
        priority,
        cardCount: conceptCards.length,
        estimatedMinutes,
      };
    });

    // Readiness + coverage, computed exactly like /api/metrics/readiness so the
    // mentor's numbers match the Schedule page. Iterate the RAW prereq list and
    // divide by its length: a dangling/unstudied id contributes 0 and is not
    // covered, but still counts toward the denominator (same as the route).
    let totalR = 0;
    let studiedCount = 0;
    for (const conceptId of rawPrereqIds) {
      const conceptCards = cardsByConcept.get(conceptId) ?? [];
      const reviewed = conceptCards.filter(isReviewed);
      if (reviewed.length === 0) continue; // unstudied/dangling → R = 0, not covered
      studiedCount++;
      const avg =
        reviewed.reduce(
          (sum, c) => sum + getRetrievability(dbCardToFSRS(c)),
          0
        ) / reviewed.length;
      totalR += avg;
    }
    const readinessScore =
      rawPrereqIds.length === 0 ? 1 : totalR / rawPrereqIds.length;
    const coverage =
      rawPrereqIds.length === 0 ? 1 : studiedCount / rawPrereqIds.length;

    return {
      id: lecture.id,
      title: lecture.title,
      scheduledDate: lecture.scheduled_date,
      daysUntil,
      readinessScore,
      coverage,
      imminent: isLectureImminent(
        { scheduled_date: lecture.scheduled_date },
        new Date(today)
      ),
      prereqCount: rawPrereqIds.length,
      prepMinutesRemaining: prereqs
        .filter((p) => p.status !== "strong")
        .reduce((s, p) => s + p.estimatedMinutes, 0),
      prereqs: prereqs.sort((a, b) => b.priority - a.priority),
    };
  });

  // ── Most-recent attended lecture's retention ───────────────────────────────
  const attendedPast = lectures
    .filter((l) => dayNumber(l.scheduled_date) <= todayNum && l.is_attended)
    .sort((a, b) =>
      a.scheduled_date < b.scheduled_date
        ? 1
        : a.scheduled_date > b.scheduled_date
          ? -1
          : (b.week_number ?? 0) - (a.week_number ?? 0)
    );
  const mostRecent = attendedPast[0] ?? null;

  let recentAttended: RecentLectureIntel | null = null;
  if (mostRecent) {
    const conceptIds = (
      (mostRecent.extracted_concept_ids as string[] | null) ?? []
    ).filter((id) => titleById.has(id));
    const reviewedRs: number[] = [];
    for (const conceptId of conceptIds) {
      const reviewed = (cardsByConcept.get(conceptId) ?? []).filter(isReviewed);
      for (const c of reviewed) reviewedRs.push(getRetrievability(dbCardToFSRS(c)));
    }
    recentAttended = {
      id: mostRecent.id,
      title: mostRecent.title,
      scheduledDate: mostRecent.scheduled_date,
      daysAgo: todayNum - dayNumber(mostRecent.scheduled_date),
      conceptCount: conceptIds.length,
      avgRetrievability:
        reviewedRs.length > 0
          ? reviewedRs.reduce((s, r) => s + r, 0) / reviewedRs.length
          : null,
    };
  }

  // ── Ranked top-priority actions across all upcoming lectures ────────────────
  // Only prereqs that actually need work (unstudied or weak) are surfaced.
  const topPriorities: TopPriorityAction[] = upcoming
    .flatMap((lec) =>
      lec.prereqs
        .filter((p) => p.status !== "strong")
        .map((p) => ({
          conceptTitle: p.title,
          lectureTitle: lec.title,
          daysUntil: lec.daysUntil,
          status: p.status,
          priority: p.priority,
        }))
    )
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 5);

  return {
    data: { upcoming, recentAttended, topPriorities },
    error: null,
  };
}

// ─── DSA recommendation ──────────────────────────────────────────────────────

/**
 * Compute the mentor's DSA recommendation: which patterns are weak/neglected and
 * which concrete problem(s) to solve next. Reuses lib/dsa-planner's buildDsaZones
 * (the canonical ZPD + Glicko-2 + portfolio-drift engine) so the mentor's advice
 * matches the DSA plan exactly, and adds per-pattern Glicko-2 weakness for naming.
 *
 * buildDsaZones performs reads only (no writes), so calling it here is side-effect
 * free. Returns { data: null } if DSA planning data can't be loaded.
 */
export async function computeDsaRecommendation(
  supabase: Client,
  userId: string
): Promise<{ data: DsaRecommendation | null; error: string | null }> {
  const [zonesRes, masteryRes] = await Promise.all([
    buildDsaZones(supabase, userId),
    supabase
      .from("pattern_mastery")
      .select("pattern, rating, rd, volatility, last_attempt_at")
      .eq("user_id", userId),
  ]);

  if (zonesRes.error || !zonesRes.data) {
    return { data: null, error: zonesRes.error ?? "No DSA data" };
  }
  const z = zonesRes.data;
  const globalSkill = z.global_skill;

  // ZPD band reflects rd-adaptive targeting + cold-start transfer toward the
  // user's global rating — matching exactly what the planner selects against.
  // rd is the EFFECTIVE value (read-time inactivity inflation via currentRd),
  // consistent with buildDsaZones.
  const weakestPatterns: WeakPattern[] = (masteryRes.data ?? [])
    .map((row) => {
      const r = { ...row, rd: currentRd(row.rd, row.volatility, row.last_attempt_at) };
      return {
        pattern: r.pattern,
        rating: Math.round(r.rating),
        weakness: weaknessFromMastery(r.rating, r.rd),
        zpd: zpdTarget(
          effectiveRating(
            { rating: r.rating, rd: r.rd },
            globalSkill.globalRating,
            globalSkill.globalRd,
          ),
        ).band,
      };
    })
    .sort((a, b) => b.weakness - a.weakness)
    .slice(0, 3);

  return {
    data: {
      globalSkill,
      neglectedPatterns: z.coach.neglected,
      overPracticedPatterns: z.coach.over_practiced,
      balanceScore: z.coach.balance_score,
      weakestPatterns,
      suggestedProblems: z.zones.new_problem.items.map((p) => ({
        title: p.title,
        difficulty: p.difficulty,
        pattern: p.target_pattern,
        url: p.leetcode_url ?? null,
      })),
      dueReSolveCount: z.zones.re_solve.items.length,
      dueRecognitionDrillCount: z.zones.recognition_drill.items.length,
    },
    error: null,
  };
}
