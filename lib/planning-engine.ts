/**
 * Planning engine — zone allocation, priority scoring, and capacity fill for the
 * "Bridge & Runway" daily plan (docs/bridge-runway-spec.md §4–§5).
 *
 * This file owns the full pipeline: the deterministic zone-minute math (Phase 3),
 * the intelligence layer (scorePriority, fillZone, §10.1), and the per-user
 * orchestrator (generateDailyPlanForUser) that loads data, builds the three zones,
 * and persists the plan — shared by /api/plans/generate and the all-user cron.
 *
 * The daily study plan is partitioned into three zones:
 *   - Immediate Recall    (lock in just-attended lecture material)
 *   - Prerequisite Runway  (refresh prereqs the next lecture depends on)
 *   - General SRS          (overdue cards not in the other two zones)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { computeBlastRadius, computeCentrality } from "@/lib/concept-graph";
import {
  dbCardToFSRS,
  fsrsCardToDB,
  getRetrievability,
  newCard,
} from "@/lib/fsrs";
import { estimateCardMinutes } from "@/lib/card-estimator";
import { generateJSON } from "@/lib/openai";
import type { Database, Json } from "@/types/database";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Zone allocation percentages as stored in `users.settings.zone_allocation_preferences`.
 * Keys are snake_case to match the JSONB shape (spec §9). Each value is a
 * percentage (0–100) and the three are expected to sum to 100.
 */
export interface ZoneAllocationPreferences {
  immediate_recall: number;
  prerequisite_runway: number;
  general_srs: number;
}

/** Per-zone minute budget for a day. Keys are camelCase TS variables. */
export interface ZoneAllocation {
  immediateRecall: number;
  prerequisiteRunway: number;
  generalSrs: number;
}

/** Identifies one of the three zones (matches the keys of {@link ZoneAllocation}). */
export type ZoneName = keyof ZoneAllocation;

/** Default split when no preferences are stored or stored prefs are invalid: 40/40/20. */
export const DEFAULT_ZONE_PREFERENCES: ZoneAllocationPreferences = {
  immediate_recall: 40,
  prerequisite_runway: 40,
  general_srs: 20,
};

/**
 * Canonical zone order. Drives the deterministic tie-break: when two zones have
 * an equal fractional part, the remainder minute goes to the earlier zone here.
 */
const ZONE_ORDER: ZoneName[] = [
  "immediateRecall",
  "prerequisiteRunway",
  "generalSrs",
];

const ZERO_ALLOCATION: ZoneAllocation = {
  immediateRecall: 0,
  prerequisiteRunway: 0,
  generalSrs: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// Core apportionment (largest-remainder / Hamilton's method)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Distribute an integer `total` across `weights` so the parts:
 *   1. are non-negative integers,
 *   2. sum EXACTLY to `total`,
 *   3. follow each weight's share as closely as possible.
 *
 * Implements the spec's rounding rule: floor each exact share, then hand the
 * leftover whole units one-by-one to the entries with the largest fractional
 * part (ties broken by lower index → canonical zone order). This is the only
 * scheme that satisfies "round per zone" AND "sum exactly to the total"
 * simultaneously — naive independent rounding can over- or under-shoot.
 *
 * If every weight is 0, the total is split as evenly as possible across all
 * entries (still via largest-remainder).
 *
 * @param total   integer total to distribute (assumed ≥ 0)
 * @param weights relative shares; need NOT sum to 100 (normalized internally)
 */
function largestRemainderApportion(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (total <= 0 || n === 0) return new Array(n).fill(0);

  const weightSum = weights.reduce((acc, w) => acc + w, 0);
  // Fall back to an equal split if there is no positive weight to apportion by.
  const effectiveWeights = weightSum > 0 ? weights : new Array(n).fill(1);
  const effectiveSum = weightSum > 0 ? weightSum : n;

  const exact = effectiveWeights.map((w) => (total * w) / effectiveSum);
  const base = exact.map((x) => Math.floor(x));
  const distributed = base.reduce((acc, x) => acc + x, 0);
  let remainder = total - distributed; // integer in [0, n)

  // Order indices by fractional part desc; tie → lower index (canonical order).
  const byFraction = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const result = base.slice();
  for (let k = 0; k < byFraction.length && remainder > 0; k++) {
    result[byFraction[k].i] += 1;
    remainder -= 1;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Preference resolution
// ─────────────────────────────────────────────────────────────────────────────

function isValidPercentage(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Validate stored preferences, falling back to {@link DEFAULT_ZONE_PREFERENCES}
 * (40/40/20) when null, malformed, or summing to ≤ 0 — mirroring the defensive
 * fallback the spec mandates for `weakness_threshold`.
 */
function resolvePreferences(
  prefs: ZoneAllocationPreferences | null | undefined
): ZoneAllocationPreferences {
  if (!prefs) return DEFAULT_ZONE_PREFERENCES;

  const { immediate_recall, prerequisite_runway, general_srs } = prefs;
  if (
    !isValidPercentage(immediate_recall) ||
    !isValidPercentage(prerequisite_runway) ||
    !isValidPercentage(general_srs)
  ) {
    return DEFAULT_ZONE_PREFERENCES;
  }
  if (immediate_recall + prerequisite_runway + general_srs <= 0) {
    return DEFAULT_ZONE_PREFERENCES;
  }
  return { immediate_recall, prerequisite_runway, general_srs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split a daily goal (in minutes) across the three zones per the configured
 * percentages, guaranteeing the parts sum EXACTLY to `dailyGoalMinutes`.
 *
 * Rules (AGENTS.md "Zone allocation math rules", spec §5):
 *   - `prefs == null` → default 40/40/20.
 *   - Each zone ≈ round(dailyGoalMinutes × pct / 100).
 *   - Rounding remainder goes to the zone with the largest fractional part
 *     (ties → canonical order: immediate_recall, prerequisite_runway, general_srs).
 *   - `dailyGoalMinutes` of 0, null, negative, or non-finite → all zeros.
 *
 * @example allocateZoneMinutes(60, null)            // → { 24, 24, 12 }
 * @example allocateZoneMinutes(60, {40,40,20})      // → { 24, 24, 12 }
 * @example allocateZoneMinutes(50, {50,30,20})      // → { 25, 15, 10 }
 * @example allocateZoneMinutes(33, null)            // → { 13, 13, 7 }  (0.6 frac → general_srs)
 * @example allocateZoneMinutes(0,  null)            // → { 0,  0,  0 }
 * @example allocateZoneMinutes(null, null)          // → { 0,  0,  0 }
 */
export function allocateZoneMinutes(
  dailyGoalMinutes: number | null,
  prefs: ZoneAllocationPreferences | null
): ZoneAllocation {
  const goal =
    typeof dailyGoalMinutes === "number" && Number.isFinite(dailyGoalMinutes)
      ? Math.round(dailyGoalMinutes)
      : 0;
  if (goal <= 0) return { ...ZERO_ALLOCATION };

  const p = resolvePreferences(prefs);
  const [immediateRecall, prerequisiteRunway, generalSrs] =
    largestRemainderApportion(goal, [
      p.immediate_recall,
      p.prerequisite_runway,
      p.general_srs,
    ]);

  return { immediateRecall, prerequisiteRunway, generalSrs };
}

/**
 * Redistribute the minutes of empty zones (zones with no eligible items)
 * proportionally onto the remaining non-empty zones, preserving the total.
 * Runs BEFORE capacity fill (spec §5.2; Kiro Req 4.7/4.9/4.10).
 *
 * The redistributed result keeps each surviving zone's share in proportion to
 * its current allocation, re-apportioned over the full total via the same
 * largest-remainder rounding (so it still sums exactly to the original total).
 * If the surviving zones currently hold 0 minutes between them, the total is
 * split evenly among them.
 *
 * Rules:
 *   - Empty zones → 0 minutes.
 *   - Non-empty zones absorb the freed minutes proportionally.
 *   - Sum is preserved (== sum of the input allocation == dailyGoalMinutes).
 *   - If ALL zones are empty → all zeros.
 *   - `emptyZones == []` → allocation returned unchanged.
 *
 * @example redistributeMinutes({24,24,12}, ["generalSrs"])
 *            // → { 30, 30, 0 }   (12 freed; split 1:1 over the two survivors)
 * @example redistributeMinutes({24,24,12}, ["prerequisiteRunway","generalSrs"])
 *            // → { 60, 0,  0 }   (all minutes onto the sole survivor)
 * @example redistributeMinutes({24,24,12}, [])
 *            // → { 24, 24, 12 }  (nothing empty → unchanged)
 * @example redistributeMinutes({24,24,12}, ["immediateRecall","prerequisiteRunway","generalSrs"])
 *            // → { 0,  0,  0 }   (all empty)
 */
export function redistributeMinutes(
  allocation: ZoneAllocation,
  emptyZones: ZoneName[]
): ZoneAllocation {
  const total = Math.round(
    allocation.immediateRecall +
      allocation.prerequisiteRunway +
      allocation.generalSrs
  );

  const empty = new Set(emptyZones);
  const survivors = ZONE_ORDER.filter((zone) => !empty.has(zone));

  // All zones empty (or nothing to distribute) → all zeros.
  if (survivors.length === 0 || total <= 0) return { ...ZERO_ALLOCATION };

  // Weight each survivor by its current allocation so proportions are kept.
  const weights = survivors.map((zone) => allocation[zone]);
  const parts = largestRemainderApportion(total, weights);

  const result: ZoneAllocation = { ...ZERO_ALLOCATION };
  survivors.forEach((zone, idx) => {
    result[zone] = parts[idx];
  });
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Priority scoring (spec §4) + capacity fill (spec §5)
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal shape of an `aiml_concepts` row needed for priority scoring. */
export interface ConceptRow {
  id: string;
  prerequisites: string[] | null;
}

/** Minimal shape of a `lecture_schedules` row needed for priority scoring. */
export interface LectureRow {
  id: string;
  scheduled_date: string; // 'YYYY-MM-DD' (date-only) or ISO timestamp
  prerequisite_concept_ids: string[] | null; // blast radius (concept-graph) reads this
}

/** Minimal `srs_cards` shape needed to derive retrievability via FSRS. */
export interface SrsCard {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: string;
  last_review: string | null;
}

/** Why an item is in the plan (spec §9 plan-item schema). */
export type PlanItemReason =
  | "weak_prereq"
  | "immediate"
  | "cold_start"
  | "cold_start_primer"
  | "overdue"
  | "lookahead_prereq";

/** A single ranked entry in a zone's plan (spec §9). */
export interface PlanItem {
  card_id: string | null;
  concept_id: string | null;
  priority: number;
  est_minutes: number;
  reason: PlanItemReason;
  /** Min retrievability of the source concept; used for the §4.4 tie-break. */
  retrievability?: number;
}

/**
 * Relevance weights (spec §4.2). `lookaheadDays` is the proximity window W;
 * it lives on `users.settings.lookahead_days` but travels with the weights here
 * since {@link scorePriority} takes no separate date/window argument.
 */
export interface PriorityWeights {
  blast: number;
  centrality: number;
  proximity: number;
  lookaheadDays?: number;
}

/** Default relevance weights and proximity window (spec §4.2). */
export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = {
  blast: 0.45,
  centrality: 0.3,
  proximity: 0.25,
  lookaheadDays: 14,
};

/** Relevance floor ε in `Priority = U × (ε + (1−ε)·Relevance)` (spec §4.2). */
const PRIORITY_FLOOR = 0.15;

/** Default proximity window W (days) when unset/invalid (spec §4.2). */
const DEFAULT_LOOKAHEAD_DAYS = 14;

/**
 * Priority returned for an unstudied concept (no cards). Sits above the normal
 * priority ceiling of 1.0 so cold-start primers sort to the front of the Runway
 * zone (spec §6). Whether such a concept is *surfaced* at all (only for an
 * imminent lecture) is the caller's decision; this function just ranks it max.
 */
export const COLD_START_PRIORITY = 2.0;

/**
 * Lookahead window (days) within which an unstudied prerequisite's lecture is
 * "imminent" enough to trigger cold-start remediation (spec §6). Unstudied
 * prereqs of a more distant lecture are only labeled, never seeded.
 */
export const COLD_START_WINDOW_DAYS = 7;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Validate relevance weights, falling back to defaults if any is malformed. */
function resolveWeights(weights: PriorityWeights): PriorityWeights {
  const valid = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (
    !valid(weights?.blast) ||
    !valid(weights?.centrality) ||
    !valid(weights?.proximity)
  ) {
    return DEFAULT_PRIORITY_WEIGHTS;
  }
  return weights;
}

/** Parse a 'YYYY-MM-DD' (or ISO) date to its UTC-midnight calendar day. */
function toUtcDay(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_DAY);
}

/**
 * Whole-day difference (lecture − today). Compares calendar days at UTC so a
 * same-day lecture is 0 and a past lecture is negative. Timezone-correct "today"
 * resolution (spec §9.4) happens in the plan orchestrator; this is a coarse,
 * date-only difference suitable for the proximity ramp.
 */
function daysUntil(scheduledDate: string, today: Date): number {
  const lecture = new Date(scheduledDate);
  if (Number.isNaN(lecture.getTime())) return Number.POSITIVE_INFINITY;
  return toUtcDay(lecture) - toUtcDay(today);
}

/**
 * Proximity P = clamp((W − d) / W, 0, 1) where d = days until the lecture and
 * W = lookahead window (spec §4.2). Lecture today/overdue → 1; ≥ W days out → 0.
 * No lecture → 0. `today` is injectable for deterministic testing; it defaults
 * to the current date.
 *
 * @example computeProximity({scheduled_date:'2026-06-08'}, 14, new Date('2026-06-07')) // d=1 → 13/14 ≈ 0.929
 */
export function computeProximity(
  nextLecture: { scheduled_date: string } | null,
  lookaheadDays: number = DEFAULT_LOOKAHEAD_DAYS,
  today: Date = new Date()
): number {
  if (!nextLecture) return 0;
  const W =
    Number.isFinite(lookaheadDays) && lookaheadDays > 0
      ? lookaheadDays
      : DEFAULT_LOOKAHEAD_DAYS;
  const d = daysUntil(nextLecture.scheduled_date, today);
  return clamp01((W - d) / W);
}

/**
 * Whether the next lecture is imminent enough to warrant cold-start remediation
 * for its unstudied prerequisites (spec §6): scheduled today or later (not in the
 * past) and within `windowDays`. Distant unstudied prereqs are left labeled only.
 *
 * `today` is injectable for deterministic testing; it defaults to the current
 * date. Returns false when there is no next lecture.
 *
 * @example isLectureImminent({scheduled_date:'2026-06-12'}, new Date('2026-06-07')) // d=5 → true
 * @example isLectureImminent({scheduled_date:'2026-06-30'}, new Date('2026-06-07')) // d=23 → false
 */
export function isLectureImminent(
  nextLecture: { scheduled_date: string } | null,
  today: Date = new Date(),
  windowDays: number = COLD_START_WINDOW_DAYS
): boolean {
  if (!nextLecture) return false;
  const W =
    Number.isFinite(windowDays) && windowDays >= 0
      ? windowDays
      : COLD_START_WINDOW_DAYS;
  const d = daysUntil(nextLecture.scheduled_date, today);
  return d >= 0 && d <= W;
}

/**
 * Score a candidate prerequisite concept for the Runway zone (spec §4.2).
 *
 *   R         = min retrievability across the concept's cards
 *   U         = 1 − R                          (urgency; gates the score)
 *   C         = normalized centrality          (lib/concept-graph)
 *   B         = blast radius w.r.t. nextLecture (lib/concept-graph)
 *   P         = proximity ramp toward the lecture
 *   Relevance = blast·B + centrality·C + proximity·P
 *   Priority  = U × (0.15 + 0.85 · Relevance)
 *
 * Unstudied concepts (no cards) are fully unknown → maximal urgency: they return
 * {@link COLD_START_PRIORITY} (2.0) so they sort ahead of all studied items.
 *
 * Pure and synchronous — no `{ data, error }` tuple. Centrality is graph-global,
 * so callers scoring many concepts should compute it ONCE via
 * {@link computeCentrality} and pass it as `precomputedCentrality` — this avoids
 * rebuilding the graph per call (O(weak·N²) → O(N²) once). When omitted it is
 * computed from `allConcepts` for convenience.
 */
export function scorePriority(
  concept: ConceptRow,
  cards: SrsCard[],
  nextLecture: LectureRow | null,
  allConcepts: ConceptRow[],
  weights: PriorityWeights,
  precomputedCentrality?: Map<string, number>
): number {
  // Cold start: no cards means the concept is fully unknown (spec §6).
  if (cards.length === 0) return COLD_START_PRIORITY;

  const R = Math.min(...cards.map(cardRetrievability));
  const U = 1 - R;

  const w = resolveWeights(weights);
  const centrality = precomputedCentrality ?? computeCentrality(allConcepts);
  const C = clamp01(centrality.get(concept.id) ?? 0);
  const B = nextLecture
    ? clamp01(computeBlastRadius(concept.id, nextLecture, allConcepts))
    : 0;
  const P = computeProximity(nextLecture, w.lookaheadDays);

  const relevance = w.blast * B + w.centrality * C + w.proximity * P;
  return U * (PRIORITY_FLOOR + (1 - PRIORITY_FLOOR) * relevance);
}

/** Safe non-negative minutes for an item (guards missing/invalid estimates). */
function itemMinutes(item: PlanItem): number {
  return Number.isFinite(item.est_minutes) && item.est_minutes > 0
    ? item.est_minutes
    : 0;
}

/**
 * Capacity-aware fill for a single zone (spec §5.2).
 *
 * Items are sorted by priority descending — ties broken deterministically by
 * retrievability ascending, then concept id, then card id (spec §4.4, preserving
 * Req 2.6) — then greedily added until cumulative `est_minutes` reaches or
 * exceeds `allocatedMinutes`. The item that crosses the budget is included;
 * everything after it is carried to `deferred[]` (re-ranked tomorrow, spec §5.2).
 *
 * `allocatedMinutes ≤ 0` → every item is deferred. Pure and synchronous — no
 * `{ data, error }` tuple.
 */
export function fillZone(
  items: PlanItem[],
  allocatedMinutes: number
): { items: PlanItem[]; deferred: PlanItem[] } {
  const sorted = [...items].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority; // priority desc
    // §4.4 tie-break: retrievability ascending (most-forgotten first)
    const ra = a.retrievability ?? Number.POSITIVE_INFINITY;
    const rb = b.retrievability ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    // then concept id ascending
    const ca = a.concept_id ?? "";
    const cb = b.concept_id ?? "";
    if (ca !== cb) return ca < cb ? -1 : 1;
    // then card id ascending (final deterministic key)
    const ka = a.card_id ?? "";
    const kb = b.card_id ?? "";
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const budget =
    Number.isFinite(allocatedMinutes) && allocatedMinutes > 0
      ? allocatedMinutes
      : 0;

  const selected: PlanItem[] = [];
  const deferred: PlanItem[] = [];
  let used = 0;

  for (const item of sorted) {
    if (used >= budget) {
      deferred.push(item);
      continue;
    }
    selected.push(item);
    used += itemMinutes(item);
  }

  return { items: selected, deferred };
}

/**
 * Minimal shape of a freshly generated cold-start seed card (spec §6) needed to
 * build its plan item. `source_id` is the prerequisite concept the card teaches;
 * `est_minutes` is its per-card time estimate (lib/card-estimator).
 */
export interface ColdStartCard {
  id: string;
  source_id: string;
  est_minutes: number;
}

/**
 * Build front-of-Runway plan items from freshly generated cold-start seed cards
 * (spec §6). Each card is stamped with:
 *   - the {@link COLD_START_PRIORITY} sentinel (2.0), above the normal priority
 *     ceiling of 1.0, so {@link fillZone} sorts these ahead of every weak prereq;
 *   - the `cold_start_primer` reason; and
 *   - retrievability 0 (the concept is fully unknown), which keeps the §4.4
 *     tie-break deterministic among the primers themselves (by concept/card id).
 *
 * Callers place the result at the FRONT of the Runway zone, before weak prereqs.
 * Pure and synchronous — no `{ data, error }` tuple.
 */
export function buildColdStartItems(seedCards: ColdStartCard[]): PlanItem[] {
  return seedCards.map((card) => ({
    card_id: card.id,
    concept_id: card.source_id,
    priority: COLD_START_PRIORITY,
    est_minutes: card.est_minutes,
    reason: "cold_start_primer",
    retrievability: 0,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan orchestrator (spec §5 / §14 step 4)
//
// generateDailyPlanForUser ties the whole engine together for ONE user: it loads
// that user's schedule/cards/concepts, classifies the next lecture's prerequisites,
// builds the three zones, allocates + redistributes minutes, capacity-fills each,
// and upserts the result into daily_plans. It is client-agnostic — pass either the
// cookie-scoped server client (on-demand /api/plans/generate) or the service-role
// admin client (the cron that regenerates every user's plan). The supplied client
// MUST already be authorized for `userId`'s rows (RLS for the server client, full
// access for the admin client) — this function never calls auth.getUser().
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_DAILY_GOAL_MINUTES = 60; // matches users.daily_goal_minutes DB default
const DEFAULT_WEAKNESS_THRESHOLD = 0.85; // spec §3 / AGENTS.md
// Cold-start remediation seeds 3–5 cards per imminent unstudied prereq (spec §6).
const COLD_START_MIN_CARDS = 3;
const COLD_START_MAX_CARDS = 5;

/** Any authorized Supabase client (server cookie-scoped or service-role admin). */
type PlanningClient = SupabaseClient<Database>;

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

type LectureScheduleRow = Database["public"]["Tables"]["lecture_schedules"]["Row"];

interface UserSettings {
  timezone?: unknown;
  weakness_threshold?: unknown;
  zone_allocation_preferences?: unknown;
}

/** Shape persisted into daily_plans.generated_plan (spec §9). */
export interface GeneratedPlan {
  zones: {
    immediate_recall: { allocated_minutes: number; items: PlanItem[] };
    prerequisite_runway: { allocated_minutes: number; items: PlanItem[] };
    general_srs: { allocated_minutes: number; items: PlanItem[] };
  };
  deferred: PlanItem[];
}

const CARD_COLUMNS =
  "id, source_id, source_type, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review";

/** Validate an IANA timezone via Intl; fall back to UTC (spec §9.4, AGENTS.md). */
function resolveTimeZone(tz: unknown): string {
  if (typeof tz === "string" && tz.length > 0) {
    try {
      // Throws RangeError for an unknown/invalid IANA zone.
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    } catch {
      // fall through to UTC
    }
  }
  return "UTC";
}

/** Clamp the weakness threshold to (0, 1]; fall back to the default (spec §3). */
function resolveThreshold(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1
    ? value
    : DEFAULT_WEAKNESS_THRESHOLD;
}

/** Coerce stored zone prefs to the typed shape, or null so the engine defaults to 40/40/20. */
function resolveZonePrefs(value: unknown): ZoneAllocationPreferences | null {
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const { immediate_recall, prerequisite_runway, general_srs } = o;
    if (
      typeof immediate_recall === "number" &&
      typeof prerequisite_runway === "number" &&
      typeof general_srs === "number"
    ) {
      return { immediate_recall, prerequisite_runway, general_srs };
    }
  }
  return null;
}

function cardRetrievability(card: SrsCard): number {
  // Never-reviewed cards (e.g. auto-seeded cold-start primers) represent zero
  // knowledge. getRetrievability returns 1 for stability-0 cards, which would
  // mask an unstudied prereq as fully mastered and drop it from the Runway —
  // treat it as R=0 (spec §6: unstudied prereq is U=1, max urgency).
  if (card.state === "new" || (card.reps ?? 0) === 0) return 0;
  return getRetrievability(dbCardToFSRS(card));
}

/** Build a zone plan item from a card. Priority defaults to urgency (1 − R). */
function cardToItem(card: CardRow, reason: PlanItemReason, priority?: number): PlanItem {
  const r = cardRetrievability(card);
  return {
    card_id: card.id,
    concept_id: card.source_type === "aiml_concept" ? card.source_id : null,
    priority: priority ?? 1 - r,
    est_minutes: estimateCardMinutes(
      card as Database["public"]["Tables"]["srs_cards"]["Row"]
    ),
    reason,
    retrievability: r,
  };
}

interface PrimerResult {
  cards: { front: string; back: string }[];
}

/**
 * Cold-start remediation (spec §6). For each imminent unstudied prerequisite,
 * reuse the Req 6 AI ingestion pipeline — but sourced from the concept's OWN
 * definition/notes rather than uploaded lecture material — to generate 3–5 seed
 * cards. Cards are persisted with `source_type='aiml_concept'`, due today (in the
 * user's timezone), so the prereq moves out of the "unstudied" state and gets
 * locked in against the forgetting curve. Returns the freshly created card rows.
 *
 * Best-effort and self-idempotent: once seed cards exist the concept is no longer
 * unstudied, so a later regeneration classifies it as a weak prereq instead of
 * re-seeding. A concept whose AI generation fails, yields < {@link
 * COLD_START_MIN_CARDS} valid cards, or whose insert errors is skipped (left
 * labeled, retried on the next generation) — it never fails the whole plan.
 */
async function remediateColdStart(
  supabase: PlanningClient,
  userId: string,
  conceptIds: string[],
  conceptMeta: Map<string, { title: string; notes: string | null }>,
  dueToday: string
): Promise<CardRow[]> {
  const created: CardRow[] = [];

  for (const conceptId of conceptIds) {
    const meta = conceptMeta.get(conceptId);
    if (!meta) continue;

    // Source the prompt from the concept's definition (notes), falling back to
    // its title when no notes are stored (spec §6 — sourced from concept text).
    const definition = meta.notes?.trim() || meta.title.trim();

    const { data: result } = await generateJSON<PrimerResult>(
      "You are an expert AI tutor. From a single concept's definition, write a short " +
        "primer and spaced-repetition flashcards that teach it from first principles.",
      `Generate ${COLD_START_MIN_CARDS}–${COLD_START_MAX_CARDS} front-and-back ` +
        `flashcards that teach the concept "${meta.title}" from scratch. ` +
        `Return JSON: { "cards": [{ "front", "back" }] }\n\n` +
        `Concept definition:\n${definition}`
    );

    const validCards = (result?.cards ?? [])
      .filter(
        (c): c is { front: string; back: string } =>
          !!c &&
          typeof c.front === "string" &&
          c.front.trim().length > 0 &&
          typeof c.back === "string" &&
          c.back.trim().length > 0
      )
      .slice(0, COLD_START_MAX_CARDS);

    // Too few cards → skip; the prereq stays unstudied and retryable next run.
    if (validCards.length < COLD_START_MIN_CARDS) continue;

    const dbCards = validCards.map((c) => ({
      user_id: userId,
      card_type: "concept",
      front: c.front.trim(),
      back: c.back.trim(),
      source_type: "aiml_concept",
      source_id: conceptId,
      ...fsrsCardToDB(newCard()),
      due: dueToday, // due today in the user's timezone (overrides newCard default)
    }));

    const { data: inserted, error } = await supabase
      .from("srs_cards")
      .insert(dbCards)
      .select(CARD_COLUMNS);

    if (error || !inserted) continue; // best-effort — don't fail the whole plan
    created.push(...(inserted as CardRow[]));
  }

  return created;
}

/**
 * Generate (and persist) the zone-partitioned daily plan for a single user.
 *
 * Pipeline (spec §5):
 *   1. Resolve "today" in the user's timezone (spec §9.4; fall back to UTC).
 *   2. Load schedule, cards, concepts, and the goal/threshold/zone settings.
 *   3. Determine Next_Lecture (Runway target) and Most_Recent_Lecture (Immediate Recall).
 *   4. Classify the next lecture's prerequisites: weak / unstudied / strong (skip).
 *   5. Build the three zones, allocate + redistribute minutes, and capacity-fill each.
 *   6. Upsert the result into daily_plans for (user_id, today).
 *
 * Returns a `{ data, error }` tuple (codebase convention). The caller is
 * responsible for authentication; this function trusts `userId`.
 */
export async function generateDailyPlanForUser(
  supabase: PlanningClient,
  userId: string
): Promise<{ data: { plan: GeneratedPlan } | null; error: string | null }> {
  // ── 1–2. Profile, settings, and today's date in the user's timezone ──────────
  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("daily_goal_minutes, settings")
    .eq("id", userId)
    .single();

  if (profileError) {
    return { data: null, error: "Failed to load user profile" };
  }

  const settings = (profile?.settings ?? {}) as UserSettings;
  const timeZone = resolveTimeZone(settings.timezone);
  const today = formatInTimeZone(new Date(), timeZone, "yyyy-MM-dd");
  const dailyGoalMinutes = profile?.daily_goal_minutes ?? DEFAULT_DAILY_GOAL_MINUTES;
  const weaknessThreshold = resolveThreshold(settings.weakness_threshold);
  const zonePrefs = resolveZonePrefs(settings.zone_allocation_preferences);

  // ── 2. Load schedule, cards, and concepts (all RLS-scoped to this user) ──────
  const [schedulesRes, cardsRes, conceptsRes] = await Promise.all([
    supabase.from("lecture_schedules").select("*").eq("user_id", userId),
    supabase.from("srs_cards").select(CARD_COLUMNS).eq("user_id", userId),
    supabase
      .from("aiml_concepts")
      .select("id, prerequisites, title, notes")
      .eq("user_id", userId),
  ]);

  const firstError = schedulesRes.error || cardsRes.error || conceptsRes.error;
  if (firstError) {
    return { data: null, error: `Failed to load planning data: ${firstError.message}` };
  }

  const schedules = (schedulesRes.data ?? []) as LectureScheduleRow[];
  const cards = (cardsRes.data ?? []) as CardRow[];
  // Full concept rows feed §4 scoring (centrality + blast radius via scorePriority).
  const allConcepts = (conceptsRes.data ?? []).map((c) => ({
    id: c.id,
    prerequisites: c.prerequisites,
  }));
  const conceptById = new Map(allConcepts.map((c) => [c.id, c]));
  const conceptIds = new Set(allConcepts.map((c) => c.id));
  // title/notes feed cold-start primer generation (spec §6); kept separate from
  // the {id, prerequisites} shape the graph scorer needs.
  const conceptMeta = new Map(
    (conceptsRes.data ?? []).map((c) => [c.id, { title: c.title, notes: c.notes }])
  );

  // ── 3. Next_Lecture and Most_Recent_Lecture (tie-breaks, spec §10 / Req 9–10) ─
  // Sort ascending by (scheduled_date, week_number) — same key as the DB index.
  const sorted = [...schedules].sort((a, b) =>
    a.scheduled_date < b.scheduled_date
      ? -1
      : a.scheduled_date > b.scheduled_date
        ? 1
        : a.week_number - b.week_number
  );
  // Next_Lecture: earliest un-attended lecture on/after today (tie → lowest week_number).
  const nextLecture =
    sorted.find((s) => s.scheduled_date >= today && !s.is_attended) ?? null;
  // Most_Recent_Lecture: latest attended lecture on/before today (tie → highest week_number).
  const attendedPast = sorted.filter((s) => s.scheduled_date <= today && s.is_attended);
  const mostRecentLecture = attendedPast.at(-1) ?? null;

  // Second upcoming lecture for multi-week look-ahead (spec §7).
  // Cap: one lecture ahead of nextLecture — do not scan the full schedule.
  const nextLectureIdx = nextLecture
    ? sorted.findIndex((s) => s.id === nextLecture.id)
    : -1;
  const secondLecture: LectureScheduleRow | null =
    nextLectureIdx >= 0
      ? (sorted.slice(nextLectureIdx + 1).find((s) => !s.is_attended) ?? null)
      : null;

  // Index cards by their source concept (source_type = 'aiml_concept').
  const cardsByConcept = new Map<string, CardRow[]>();
  for (const card of cards) {
    if (card.source_type !== "aiml_concept") continue;
    const list = cardsByConcept.get(card.source_id);
    if (list) list.push(card);
    else cardsByConcept.set(card.source_id, [card]);
  }

  // ── 4. Classify the next lecture's prerequisites ─────────────────────────────
  const prereqIds = (nextLecture?.prerequisite_concept_ids ?? []).filter((id) =>
    conceptIds.has(id)
  );

  const unstudiedPrereqIds: string[] = [];
  const weakPrereqs: { conceptId: string; minRetrievability: number; cards: CardRow[] }[] =
    [];

  for (const conceptId of prereqIds) {
    const conceptCards = cardsByConcept.get(conceptId) ?? [];
    if (conceptCards.length === 0) {
      unstudiedPrereqIds.push(conceptId); // unstudied (no cards)
      continue;
    }
    const minRetrievability = Math.min(...conceptCards.map(cardRetrievability));
    if (minRetrievability < weaknessThreshold) {
      weakPrereqs.push({ conceptId, minRetrievability, cards: conceptCards });
    }
    // else: strong → skip
  }

  // ── 5a. Immediate Recall zone — cards from the most-recent lecture's concepts ─
  const recallConceptIds = new Set(mostRecentLecture?.extracted_concept_ids ?? []);
  const immediateItems: PlanItem[] = cards
    .filter(
      (c) => c.source_type === "aiml_concept" && recallConceptIds.has(c.source_id)
    )
    .map((c) => cardToItem(c, "immediate"));

  // ── 5b. Prerequisite Runway zone — cold-start primers + priority-scored prereqs ─
  // Cold start (spec §6): when the next lecture is imminent (within 7 days), each
  // unstudied prereq is remediated NOW — the AI ingestion pipeline (sourced from
  // the concept's own definition) generates 3–5 seed cards, which become front-of-
  // Runway primer items (priority 2.0 sentinel) ahead of all weak prereqs.
  const dueToday = fromZonedTime(`${today}T00:00:00`, timeZone).toISOString();
  const coldStartCards =
    isLectureImminent(nextLecture, new Date(today)) && unstudiedPrereqIds.length > 0
      ? await remediateColdStart(
          supabase,
          userId,
          unstudiedPrereqIds,
          conceptMeta,
          dueToday
        )
      : [];

  const coldStartItems: PlanItem[] = buildColdStartItems(
    coldStartCards.map((c) => ({
      id: c.id,
      source_id: c.source_id,
      est_minutes: estimateCardMinutes(
        c as Database["public"]["Tables"]["srs_cards"]["Row"]
      ),
    }))
  );

  // Weak prereqs ranked by the §4 priority score (urgency-gated relevance), not raw
  // retrievability. All cards of a concept inherit that concept's priority; fillZone
  // sorts descending and tie-breaks on retrievability (preserving determinism).
  // Centrality is graph-global, so compute it once and reuse across every concept.
  const centrality = computeCentrality(allConcepts);
  const weakItems: PlanItem[] = weakPrereqs.flatMap((p) => {
    const concept = conceptById.get(p.conceptId) ?? {
      id: p.conceptId,
      prerequisites: null,
    };
    const priority = scorePriority(
      concept,
      p.cards,
      nextLecture,
      allConcepts,
      DEFAULT_PRIORITY_WEIGHTS,
      centrality
    );
    return p.cards.map((card) => cardToItem(card, "weak_prereq", priority));
  });

  const primaryRunwayItems: PlanItem[] = [...coldStartItems, ...weakItems];

  // ── 5b continued. Multi-week look-ahead (spec §7) ─────────────────────────
  // Score the second upcoming lecture's weak prereqs. No cold-start for look-
  // ahead (too far out). Proximity is naturally lower, so these score below
  // primary items and fill only remaining runway capacity.
  const primaryPrereqSet = new Set(prereqIds);
  const lookaheadItems: PlanItem[] = [];
  if (secondLecture) {
    const secondPrereqIds = (secondLecture.prerequisite_concept_ids ?? []).filter(
      (id) => conceptIds.has(id) && !primaryPrereqSet.has(id)
    );
    for (const conceptId of secondPrereqIds) {
      const conceptCards = cardsByConcept.get(conceptId) ?? [];
      if (conceptCards.length === 0) continue; // skip unstudied — no cold-start for look-ahead
      const minR = Math.min(...conceptCards.map(cardRetrievability));
      if (minR >= weaknessThreshold) continue; // strong → skip
      const concept = conceptById.get(conceptId) ?? { id: conceptId, prerequisites: null };
      const priority = scorePriority(
        concept,
        conceptCards,
        secondLecture,
        allConcepts,
        DEFAULT_PRIORITY_WEIGHTS,
        centrality
      );
      conceptCards.forEach((card) =>
        lookaheadItems.push(cardToItem(card, "lookahead_prereq", priority))
      );
    }
  }

  // ── 5c. General SRS zone — overdue cards not already placed in another zone ───
  const now = Date.now();
  const placedCardIds = new Set(
    [...immediateItems, ...primaryRunwayItems, ...lookaheadItems]
      .map((i) => i.card_id)
      .filter((id): id is string => id !== null)
  );
  const dueCards = cards.filter((c) => new Date(c.due).getTime() <= now);
  const generalItems: PlanItem[] = dueCards
    .filter((c) => !placedCardIds.has(c.id))
    .map((c) => cardToItem(c, "overdue"));

  // ── 6. Allocate minutes, redistribute empty zones, then capacity-fill ────────
  const allocation = allocateZoneMinutes(dailyGoalMinutes, zonePrefs);

  const emptyZones: ZoneName[] = [];
  if (immediateItems.length === 0) emptyZones.push("immediateRecall");
  // Runway is non-empty when primary items OR look-ahead items exist (spec §7).
  if (primaryRunwayItems.length === 0 && lookaheadItems.length === 0)
    emptyZones.push("prerequisiteRunway");
  if (generalItems.length === 0) emptyZones.push("generalSrs");

  const minutes = redistributeMinutes(allocation, emptyZones);

  const immediate = fillZone(immediateItems, minutes.immediateRecall);

  // Two-pass runway fill (spec §7): primary items consume budget first; look-ahead
  // fills only what remains. Look-ahead overflow is dropped (not deferred) — items
  // far from their lecture should never pollute tomorrow's deferred list.
  const primaryRunwayFill = fillZone(primaryRunwayItems, minutes.prerequisiteRunway);
  const primaryMinutesUsed = primaryRunwayFill.items.reduce(
    (sum, item) => sum + itemMinutes(item),
    0
  );
  const remainingRunwayBudget = minutes.prerequisiteRunway - primaryMinutesUsed;
  const lookaheadFill =
    remainingRunwayBudget > 0 && lookaheadItems.length > 0
      ? fillZone(lookaheadItems, remainingRunwayBudget)
      : { items: [] as PlanItem[], deferred: [] as PlanItem[] };
  const runway = {
    items: [...primaryRunwayFill.items, ...lookaheadFill.items],
    deferred: primaryRunwayFill.deferred,
  };

  const general = fillZone(generalItems, minutes.generalSrs);

  // ── 7. Persist the zone-partitioned plan (spec §9 generated_plan shape) ──────
  const generatedPlan: GeneratedPlan = {
    zones: {
      immediate_recall: {
        allocated_minutes: minutes.immediateRecall,
        items: immediate.items,
      },
      prerequisite_runway: {
        allocated_minutes: minutes.prerequisiteRunway,
        items: runway.items,
      },
      general_srs: {
        allocated_minutes: minutes.generalSrs,
        items: general.items,
      },
    },
    deferred: [...immediate.deferred, ...runway.deferred, ...general.deferred],
  };

  const { error: upsertError } = await supabase.from("daily_plans").upsert(
    {
      user_id: userId,
      plan_date: today,
      generated_plan: generatedPlan as unknown as Json,
      // Cold-start seed cards are created due-today, so count them alongside
      // the cards that were already due when planning started.
      srs_due_count: dueCards.length + coldStartCards.length,
    },
    { onConflict: "user_id,plan_date" }
  );

  if (upsertError) {
    return { data: null, error: `Failed to save daily plan: ${upsertError.message}` };
  }

  return { data: { plan: generatedPlan }, error: null };
}
