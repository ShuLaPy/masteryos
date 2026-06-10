/**
 * DSA re-solve ladder (§5.3) and shared attempt/mastery logic.
 *
 * All functions accept an authenticated SupabaseClient and return { data, error }
 * tuples per codebase convention. No auth, no HTTP, no AI calls here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatInTimeZone } from "date-fns-tz";
import { dbCardToFSRS, fsrsCardToDB, newCard, reviewCard, Rating } from "@/lib/fsrs";
import {
  difficultyToRating,
  inflateRdForInactivity,
  outcomeToScore,
  updateRating,
  weaknessFromMastery,
  type AttemptOutcome,
  type Difficulty,
} from "@/lib/pattern-rating";
import { CANONICAL_PATTERNS, type CanonicalPattern } from "@/lib/pattern-map";
import {
  patternPriority,
  targetDistribution,
  actualDistribution,
  computeDrift,
  balanceScore,
  type MasterySnapshot,
} from "@/lib/dsa-coach";
import {
  zpdTarget,
  problemSignal,
  scoreProblemFit,
  DEFAULT_TARGET_SUCCESS,
  type ZpdTarget,
} from "@/lib/zpd";
import {
  computeGlobalSkill,
  effectiveRating,
  type GlobalSkill,
  type SkillLevelState,
} from "@/lib/skill-level";
import type { Database } from "@/types/database";

// ─── types ───────────────────────────────────────────────────────────────────

export type Rung = 1 | 2 | 3;

export interface LadderProblem {
  id: string;
  title: string;
  difficulty: Difficulty;
  patterns: string[];
}

export interface RungCard {
  id: string;
  rung: Rung;
  due: string;
  state: string;
}

export interface PatternUpdate {
  pattern: string;
  ratingBefore: number;
  ratingAfter: number;
}

// ─── constants ───────────────────────────────────────────────────────────────

const LADDER_SOURCE_TYPE = "dsa_ladder";

const DEFAULT_RATING = 1500;
const DEFAULT_RD = 350;

/**
 * Opponent rd (Glicko scale) used when a curated per-problem Elo is the
 * opponent. Low = a confident opponent, so the match moves the learner's rating
 * decisively (vs the default RD_MAX for the coarse categorical centre).
 */
const PROBLEM_ELO_OPPONENT_RD = 60;
const DEFAULT_VOLATILITY = 0.06;

// Any rating other than Again means the user completed the full re-solve.
// Again = "couldn't code it" — no useful signal to record.
const RUNG3_SUCCESS: ReadonlySet<Rating> = new Set([
  Rating.Hard,
  Rating.Good,
  Rating.Easy,
]);

// ─── rung content ────────────────────────────────────────────────────────────

const RUNG_CARD_TYPE: Record<Rung, string> = {
  1: "rung_1",
  2: "rung_2",
  3: "rung_3",
};

function rungFront(rung: Rung, title: string): string {
  switch (rung) {
    case 1: return `Core insight: ${title}`;
    case 2: return `Approach sketch: ${title}`;
    case 3: return `Full re-solve: ${title}`;
  }
}

const RUNG_BACK: Record<Rung, string> = {
  1: "Recall the key insight that unlocks this problem (~30 s).",
  2: "Write the pseudocode / high-level approach from memory (~3–5 min).",
  3: "Code the complete solution from scratch, no hints (~20–40 min).",
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function cardTypeToRung(cardType: string): Rung | null {
  if (cardType === "rung_1") return 1;
  if (cardType === "rung_2") return 2;
  if (cardType === "rung_3") return 3;
  return null;
}

/**
 * Map a successful Rung 3 FSRS rating to a Glicko-2 outcome.
 * Hard → solved with effort; Good/Easy → solved cleanly (unaided).
 */
function ratingToOutcome(rating: Rating): AttemptOutcome {
  return rating === Rating.Hard ? "solved_effort" : "solved_fast";
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Idempotently provision all three re-solve ladder cards for a problem.
 * Existing cards are left untouched; only the missing rungs are inserted.
 * New cards are due `dueToday` (ISO UTC string, midnight in the user's timezone).
 */
export async function scheduleResolveLadder(
  supabase: SupabaseClient<Database>,
  userId: string,
  problem: LadderProblem,
  dueToday: string,
): Promise<{ data: { rungs: RungCard[] } | null; error: string | null }> {
  const { data: existing, error: fetchErr } = await supabase
    .from("srs_cards")
    .select("id, card_type, due, state")
    .eq("user_id", userId)
    .eq("source_type", LADDER_SOURCE_TYPE)
    .eq("source_id", problem.id);

  if (fetchErr) return { data: null, error: fetchErr.message };

  const existingTypes = new Set((existing ?? []).map((r) => r.card_type));

  const toInsert = ([1, 2, 3] as Rung[])
    .filter((rung) => !existingTypes.has(RUNG_CARD_TYPE[rung]))
    .map((rung) => ({
      user_id: userId,
      card_type: RUNG_CARD_TYPE[rung],
      front: rungFront(rung, problem.title),
      back: RUNG_BACK[rung],
      source_type: LADDER_SOURCE_TYPE,
      source_id: problem.id,
      ...fsrsCardToDB(newCard()),
      due: dueToday,
    }));

  let newRows: Array<{ id: string; card_type: string; due: string; state: string }> = [];

  if (toInsert.length > 0) {
    const { data: inserted, error: insertErr } = await supabase
      .from("srs_cards")
      .insert(toInsert)
      .select("id, card_type, due, state");

    if (insertErr) return { data: null, error: insertErr.message };
    newRows = (inserted ?? []) as typeof newRows;
  }

  const allRows = [...(existing ?? []), ...newRows];

  const rungs: RungCard[] = allRows
    .flatMap((r) => {
      const rung = cardTypeToRung(r.card_type);
      return rung ? [{ id: r.id, rung, due: r.due, state: r.state }] : [];
    });

  return { data: { rungs }, error: null };
}

/**
 * Review a single re-solve rung card.
 *
 * Advances the card's FSRS state using lib/fsrs.ts `reviewCard`.
 *
 * Rung 3 + rating ∈ {Hard, Good, Easy} → also calls `logAttemptAndUpdateMastery`
 * to insert a `problem_attempts` row and run the Glicko-2 mastery update for
 * every credited pattern (Phase 3 logic from the DSA mastery spec).
 */
export async function reviewRung(
  supabase: SupabaseClient<Database>,
  userId: string,
  cardId: string,
  rung: Rung,
  rating: Rating,
  context: {
    problemId: string;
    patterns: string[];
    difficulty: Difficulty;
    timeSeconds?: number;
  },
): Promise<{
  data: { nextDue: string; attemptLogged: boolean } | null;
  error: string | null;
}> {
  // Fetch the minimal card shape that dbCardToFSRS requires.
  const { data: cardRow, error: fetchErr } = await supabase
    .from("srs_cards")
    .select(
      "due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review",
    )
    .eq("id", cardId)
    .eq("user_id", userId)
    .single();

  if (fetchErr || !cardRow) {
    return { data: null, error: "Rung card not found" };
  }

  // Advance FSRS state.
  const fsrsCard = dbCardToFSRS(cardRow);
  const { updatedCard } = reviewCard(fsrsCard, rating);
  const dbFields = fsrsCardToDB(updatedCard);

  const { error: updateErr } = await supabase
    .from("srs_cards")
    .update(dbFields)
    .eq("id", cardId)
    .eq("user_id", userId);

  if (updateErr) return { data: null, error: updateErr.message };

  // Rung 3 success → log problem_attempt + update Glicko-2 mastery.
  let attemptLogged = false;
  if (rung === 3 && RUNG3_SUCCESS.has(rating)) {
    const outcome = ratingToOutcome(rating);
    const { error: attemptErr } = await logAttemptAndUpdateMastery(
      supabase,
      userId,
      context.problemId,
      context.patterns,
      context.difficulty,
      outcome,
      { timeSeconds: context.timeSeconds },
    );
    if (attemptErr) return { data: null, error: attemptErr };
    attemptLogged = true;
  }

  return { data: { nextDue: dbFields.due, attemptLogged }, error: null };
}

/**
 * Insert a `problem_attempts` row and run the Glicko-2 mastery update for
 * every credited pattern.
 *
 * This is the "Phase 3 logic" from the DSA mastery spec — the same pipeline
 * used by POST /api/dsa/attempt and by the Rung 3 review path.
 */
export async function logAttemptAndUpdateMastery(
  supabase: SupabaseClient<Database>,
  userId: string,
  problemId: string | null,
  patterns: string[],
  difficulty: Difficulty,
  outcome: AttemptOutcome,
  opts?: {
    timeSeconds?: number;
    usedHints?: boolean;
    patternIdentified?: string;
    /**
     * Curated per-problem Elo (problem_bank.elo_rating). When present it is used
     * as the Glicko opponent rating — a far sharper signal than the coarse
     * categorical centre — and treated as a confident opponent (low opponent rd)
     * so the rating moves decisively. Falls back to the categorical centre
     * (1300/1550/1800) when absent, preserving the legacy behaviour exactly.
     */
    problemElo?: number;
  },
): Promise<{ data: { updated: PatternUpdate[] } | null; error: string | null }> {
  const score = outcomeToScore(outcome);
  const hasProblemElo =
    typeof opts?.problemElo === "number" && Number.isFinite(opts.problemElo);
  const opponentRating = hasProblemElo
    ? (opts!.problemElo as number)
    : difficultyToRating(difficulty);
  const opponentRd = hasProblemElo ? PROBLEM_ELO_OPPONENT_RD : DEFAULT_RD;
  const now = new Date().toISOString();

  // Insert attempt record.
  const { error: attemptErr } = await supabase.from("problem_attempts").insert({
    user_id: userId,
    problem_id: problemId,
    patterns,
    difficulty,
    outcome_score: score,
    time_seconds: opts?.timeSeconds ?? null,
    used_hints: opts?.usedHints ?? null,
    pattern_identified: opts?.patternIdentified ?? null,
  });

  if (attemptErr) return { data: null, error: attemptErr.message };

  // Fetch current mastery for all patterns in one query.
  const { data: masteryRows, error: masteryErr } = await supabase
    .from("pattern_mastery")
    .select("*")
    .eq("user_id", userId)
    .in("pattern", patterns);

  if (masteryErr) return { data: null, error: masteryErr.message };

  const masteryMap = new Map(
    (masteryRows ?? []).map((r) => [r.pattern, r]),
  );

  // Glicko-2 update — parallel over all patterns.
  let updated: PatternUpdate[];
  try {
    updated = await Promise.all(
      patterns.map(async (pattern): Promise<PatternUpdate> => {
        const existing = masteryMap.get(pattern);
        const ratingBefore = existing?.rating ?? DEFAULT_RATING;
        const rd = existing?.rd ?? DEFAULT_RD;
        const volatility = existing?.volatility ?? DEFAULT_VOLATILITY;
        const attempts = existing?.attempts ?? 0;

        const daysSince = existing?.last_attempt_at
          ? (Date.now() - new Date(existing.last_attempt_at).getTime()) /
            86_400_000
          : 0;

        const inflatedRd = inflateRdForInactivity(rd, volatility, daysSince);
        const after = updateRating(
          { rating: ratingBefore, rd: inflatedRd, volatility },
          opponentRating,
          score,
          opponentRd,
        );

        const { error: upsertErr } = await supabase
          .from("pattern_mastery")
          .upsert(
            {
              user_id: userId,
              pattern,
              rating: after.rating,
              rd: after.rd,
              volatility: after.volatility,
              attempts: attempts + 1,
              last_attempt_at: now,
              updated_at: now,
            },
            { onConflict: "user_id,pattern" },
          );

        if (upsertErr) throw new Error(upsertErr.message);
        return { pattern, ratingBefore, ratingAfter: after.rating };
      }),
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { data: null, error: message };
  }

  return { data: { updated }, error: null };
}

// ─── DSA Zone planner (spec §6 / §7 / §9) ────────────────────────────────────
//
// buildDsaZones() orchestrates the three daily DSA zones from a separate minute
// budget (dsa_daily_goal_minutes in users.settings, default 60) and writes the
// result into daily_plans.generated_plan.dsa per the §12 JSONB shape.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Zone-planner types ───────────────────────────────────────────────────────

interface DsaZonePreferences {
  recognition_drill: number;
  re_solve: number;
  new_problem: number;
}

/** A due recognition or insight card for the Recognition Drill zone. */
export interface DrillItem {
  card_id: string;
  front: string;
  back: string;
  /** source_id of the card = dsa_problems.id that spawned it. */
  source_id: string;
  /** Primary canonical pattern; drives interleaving. */
  pattern: string;
  card_type: string;
  state: string;
  est_minutes: number;
}

/** A due ladder rung card for the Re-Solve zone. */
export interface ResolveLadderItem {
  card_id: string;
  rung: Rung;
  problem_id: string;
  title: string;
  patterns: string[];
  difficulty: string;
  /** patternPriority score; drives ranking. */
  priority: number;
  est_minutes: number;
}

/** A problem_bank candidate for the New Problem zone. */
export interface NewProblemItem {
  bank_id: string;
  slug: string;
  title: string;
  difficulty: string;
  patterns: string[];
  leetcode_url: string;
  /** The neglected/target pattern this problem addresses. */
  target_pattern: string;
  est_minutes: number;
}

export interface DsaCoachBlock {
  neglected: string[];
  over_practiced: string[];
  balance_score: number;
}

export interface DsaZoneOutput {
  /** 'YYYY-MM-DD' in the user's timezone — used by the route for plan_date. */
  plan_date: string;
  zones: {
    recognition_drill: { allocated_minutes: number; items: DrillItem[] };
    re_solve: { allocated_minutes: number; items: ResolveLadderItem[] };
    new_problem: { allocated_minutes: number; items: NewProblemItem[] };
  };
  coach: DsaCoachBlock;
  /** Global DSA skill (level, weighted rating) — drives the ZPD difficulty. */
  global_skill: GlobalSkill;
  /** Drill and re-solve cards that overflowed the minute budget. */
  deferred: Array<DrillItem | ResolveLadderItem>;
}

// ─── Zone-planner constants ────────────────────────────────────────────────────

const DEFAULT_DSA_ZONE_PREFERENCES: DsaZonePreferences = {
  recognition_drill: 35,
  re_solve: 40,
  new_problem: 25,
};

const DEFAULT_DSA_GOAL_MINUTES = 60;

const DRILL_MINUTES = 2;

const RUNG_MINUTES: Record<Rung, number> = { 1: 1, 2: 5, 3: 30 };

const NEW_PROBLEM_MINUTES: Record<string, number> = {
  easy: 20,
  medium: 45,
  hard: 60,
};

// ─── Zone-planner pure helpers ─────────────────────────────────────────────────

/**
 * Pick the ZPD difficulty BAND for a pattern given its current Glicko-2 rating.
 *
 * Thin backward-compatible shim over the continuous model in lib/zpd.ts. It runs
 * in `legacy` mode so it reproduces the historical `rating + 125` boundaries
 * (<1425→easy, 1425–1674→medium, ≥1675→hard) — display surfaces that show a
 * single band stay stable. SELECTION sites should call `zpdTarget` /
 * `scoreProblemFit` directly to get the rd-adaptive, success-targeted behaviour.
 */
export function zpdDifficulty(rating: number): Difficulty {
  return zpdTarget({ rating, rd: 50 }, { legacy: true }).band;
}

function resolveTimeZone(tz: unknown): string {
  if (typeof tz === "string" && tz.length > 0) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    } catch { /* fall through to UTC */ }
  }
  return "UTC";
}

/**
 * Resolve the per-user growth target success (the "85% rule" knob) from
 * users.settings.zpd_target_success. Falls back to the default and rejects
 * out-of-range values, mirroring how weakness_threshold is validated elsewhere.
 */
function resolveTargetSuccess(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0.5 && value < 0.95) {
    return value;
  }
  return DEFAULT_TARGET_SUCCESS;
}

/** Read a persisted skill-level label (users.settings.skill_level_cache). */
function resolvePreviousLevel(value: unknown): SkillLevelState | undefined {
  return value === "beginner" ||
    value === "intermediate" ||
    value === "advanced" ||
    value === "calibrating"
    ? value
    : undefined;
}

function resolveDsaPrefs(value: unknown): DsaZonePreferences {
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const r = o.recognition_drill;
    const s = o.re_solve;
    const n = o.new_problem;
    if (
      typeof r === "number" && typeof s === "number" && typeof n === "number" &&
      Number.isFinite(r) && Number.isFinite(s) && Number.isFinite(n) &&
      r >= 0 && s >= 0 && n >= 0 && r + s + n > 0
    ) {
      return { recognition_drill: r, re_solve: s, new_problem: n };
    }
  }
  return DEFAULT_DSA_ZONE_PREFERENCES;
}

/**
 * Largest-remainder (Hamilton) apportionment: distribute `total` across
 * `weights` so the integer parts sum EXACTLY to `total`.
 */
function apportionTotal(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (total <= 0 || n === 0) return new Array(n).fill(0) as number[];
  const sum = weights.reduce((a, b) => a + b, 0);
  const effective = sum > 0 ? weights : new Array(n).fill(1) as number[];
  const effSum = sum > 0 ? sum : n;
  const exact = effective.map((w) => (total * w) / effSum);
  const base = exact.map((x) => Math.floor(x));
  let remainder = total - base.reduce((a, b) => a + b, 0);
  const byFrac = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const result = base.slice();
  for (const { i } of byFrac) {
    if (remainder <= 0) break;
    result[i]++;
    remainder--;
  }
  return result;
}

/**
 * Move minutes from empty DSA zones to non-empty ones, preserving the total.
 * Canonical zone order: recognition_drill=0, re_solve=1, new_problem=2.
 */
function redistributeDsaMinutes(
  alloc: [number, number, number],
  isEmpty: [boolean, boolean, boolean],
): [number, number, number] {
  const total = alloc.reduce((a, b) => a + b, 0);
  const survivors: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < 3; i++) {
    if (!isEmpty[i]) { survivors.push(i); weights.push(alloc[i]); }
  }
  if (survivors.length === 0 || total <= 0) return [0, 0, 0];
  const parts = apportionTotal(total, weights);
  const result: [number, number, number] = [0, 0, 0];
  survivors.forEach((idx, k) => { result[idx] = parts[k]; });
  return result;
}

/**
 * Round-robin interleave drill cards by pattern so no two consecutive cards
 * share the same pattern — this is what builds cross-pattern recognition skill.
 */
function interleaveByPattern(items: DrillItem[]): DrillItem[] {
  const groups = new Map<string, DrillItem[]>();
  for (const item of items) {
    const g = groups.get(item.pattern);
    if (g) g.push(item);
    else groups.set(item.pattern, [item]);
  }
  const buckets = [...groups.values()];
  const maxLen = buckets.reduce((m, b) => Math.max(m, b.length), 0);
  const result: DrillItem[] = [];
  for (let i = 0; i < maxLen; i++) {
    for (const bucket of buckets) {
      if (i < bucket.length) result.push(bucket[i]);
    }
  }
  return result;
}

/** Coverage gap G for one pattern: how under-practiced it is vs its target share. */
function coverageGapForPattern(
  pattern: CanonicalPattern,
  target: Map<CanonicalPattern, number>,
  actual: Map<string, number>,
): number {
  return Math.max(0, (target.get(pattern) ?? 0) - (actual.get(pattern) ?? 0));
}

/**
 * Greedy budget fill: add items in order until cumulative est_minutes ≥ budget.
 * The budget-crossing item IS included; everything after goes to deferred.
 */
function fillBudget<T extends { est_minutes: number }>(
  items: T[],
  minutes: number,
): { items: T[]; deferred: T[] } {
  const budget = Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
  const selected: T[] = [];
  const deferred: T[] = [];
  let used = 0;
  for (const item of items) {
    if (used >= budget) { deferred.push(item); continue; }
    selected.push(item);
    used += item.est_minutes;
  }
  return { items: selected, deferred };
}

// ─── Main DSA zone orchestrator ────────────────────────────────────────────────

/**
 * Build the DSA section of the daily plan for one user.
 *
 * Uses a separate minute budget (`dsa_daily_goal_minutes` in users.settings,
 * default 60) allocated across three zones (default 35 / 40 / 25):
 *
 *   Recognition Drill  — due recognition/insight cards, interleaved by pattern
 *   Re-Solve           — due rung-1/2/3 ladder cards, ranked by patternPriority
 *   New Problem        — 1–3 problem_bank candidates at ZPD difficulty, biased
 *                        toward neglected patterns from the coach
 *
 * Returns `{ plan_date, zones, coach, deferred }` in the §12 JSONB shape.
 * The caller is responsible for persisting this into daily_plans.generated_plan.dsa.
 */
export async function buildDsaZones(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ data: DsaZoneOutput | null; error: string | null }> {
  // ── 1. User settings ────────────────────────────────────────────────────────
  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("settings")
    .eq("id", userId)
    .single();

  if (profileError) return { data: null, error: "Failed to load user profile" };

  const settings = (profile?.settings ?? {}) as Record<string, unknown>;
  const timeZone = resolveTimeZone(settings.timezone);
  const today = formatInTimeZone(new Date(), timeZone, "yyyy-MM-dd");
  const nowIso = new Date().toISOString();

  const dsaGoal =
    typeof settings.dsa_daily_goal_minutes === "number" &&
    Number.isFinite(settings.dsa_daily_goal_minutes) &&
    settings.dsa_daily_goal_minutes > 0
      ? Math.round(settings.dsa_daily_goal_minutes)
      : DEFAULT_DSA_GOAL_MINUTES;

  const dsaPrefs = resolveDsaPrefs(settings.dsa_zone_allocation_preferences);

  // ── 2. Parallel data fetch ─────────────────────────────────────────────────
  const cutoff14d = new Date(Date.now() - 14 * 86_400_000).toISOString();

  const [
    masteryRes,
    attemptsRes,
    drillCardsRes,
    ladderCardsRes,
    dsaProblemsRes,
    bankRes,
  ] = await Promise.all([
    supabase
      .from("pattern_mastery")
      .select("pattern, rating, rd, attempts")
      .eq("user_id", userId),
    supabase
      .from("problem_attempts")
      .select("patterns, created_at")
      .eq("user_id", userId)
      .gte("created_at", cutoff14d),
    supabase
      .from("srs_cards")
      .select("id, card_type, front, back, source_id, state")
      .eq("user_id", userId)
      .eq("source_type", "dsa_recognition")
      .lte("due", nowIso),
    supabase
      .from("srs_cards")
      .select("id, card_type, source_id, state")
      .eq("user_id", userId)
      .eq("source_type", "dsa_ladder")
      .lte("due", nowIso),
    supabase
      .from("dsa_problems")
      .select("id, title, difficulty, patterns, url")
      .eq("user_id", userId),
    supabase
      .from("problem_bank")
      .select(
        "id, slug, title, difficulty, patterns, leetcode_url, elo_rating, acceptance_rate",
      ),
  ]);

  const fetchErr =
    masteryRes.error ??
    attemptsRes.error ??
    drillCardsRes.error ??
    ladderCardsRes.error ??
    dsaProblemsRes.error ??
    bankRes.error;

  if (fetchErr) {
    return { data: null, error: `Failed to load DSA planning data: ${fetchErr.message}` };
  }

  // ── 3. Build lookup maps ───────────────────────────────────────────────────
  const masteryByPattern = new Map<CanonicalPattern, MasterySnapshot>(
    (masteryRes.data ?? []).map((r) => [
      r.pattern as CanonicalPattern,
      { rating: r.rating, rd: r.rd },
    ]),
  );

  const defaultMastery = (p: CanonicalPattern): MasterySnapshot =>
    masteryByPattern.get(p) ?? { rating: DEFAULT_RATING, rd: DEFAULT_RD };

  // Global skill + per-user target success drive the rd-adaptive ZPD target.
  // Shrinkage toward the global rating (empirical Bayes) is applied ONLY to the
  // difficulty target, never to weakness/priority/coach — so neglected-pattern
  // detection is unchanged while a strong learner still gets challenging
  // problems on a brand-new pattern.
  const globalSkill = computeGlobalSkill(masteryRes.data ?? [], {
    previousLevel: resolvePreviousLevel(settings.skill_level_cache),
  });
  const baseTargetSuccess = resolveTargetSuccess(settings.zpd_target_success);
  const zpdTargetFor = (p: CanonicalPattern): ZpdTarget => {
    const eff = effectiveRating(
      defaultMastery(p),
      globalSkill.globalRating,
      globalSkill.globalRd,
    );
    return zpdTarget(eff, { baseTargetSuccess });
  };

  const problemById = new Map(
    (dsaProblemsRes.data ?? []).map((p) => [p.id, p]),
  );

  // LeetCode URLs from the user's already-solved problems — exclude from bank
  const userProblemUrls = new Set(
    (dsaProblemsRes.data ?? [])
      .map((p) => p.url)
      .filter((u): u is string => typeof u === "string"),
  );

  // ── 4. Coach computation ───────────────────────────────────────────────────
  const target = targetDistribution(masteryByPattern);
  const actual = actualDistribution(attemptsRes.data ?? [], 14, Date.now());
  const { neglected, overPracticed } = computeDrift(target, actual);
  const rawScore = balanceScore(target, actual);

  const coachBlock: DsaCoachBlock = {
    neglected,
    over_practiced: overPracticed,
    balance_score: Math.round(rawScore * 100) / 100,
  };

  // ── 5. Recognition Drill Zone ──────────────────────────────────────────────
  const drillItems: DrillItem[] = (drillCardsRes.data ?? []).map((card) => {
    const problem = problemById.get(card.source_id);
    const pattern: string = (problem?.patterns as string[] | null)?.[0] ?? "unknown";
    return {
      card_id: card.id,
      front: card.front,
      back: card.back,
      source_id: card.source_id,
      pattern,
      card_type: card.card_type,
      state: card.state,
      est_minutes: DRILL_MINUTES,
    };
  });

  const interleavedDrill = interleaveByPattern(drillItems);

  // ── 6. Re-Solve Zone ───────────────────────────────────────────────────────
  const resolveItems: ResolveLadderItem[] = (ladderCardsRes.data ?? [])
    .flatMap((card) => {
      const rung = cardTypeToRung(card.card_type);
      if (!rung) return [];
      const problem = problemById.get(card.source_id);
      if (!problem) return [];

      const patterns = (problem.patterns as string[] | null) ?? [];
      const priority =
        patterns.length > 0
          ? Math.max(
              ...patterns.map((p) => {
                const cp = p as CanonicalPattern;
                const gap = coverageGapForPattern(cp, target, actual);
                return patternPriority(defaultMastery(cp), cp, gap);
              }),
            )
          : 0;

      return [
        {
          card_id: card.id,
          rung,
          problem_id: card.source_id,
          title: problem.title,
          patterns,
          difficulty: (problem.difficulty as string | null) ?? "medium",
          priority,
          est_minutes: RUNG_MINUTES[rung],
        },
      ];
    })
    .sort((a, b) => b.priority - a.priority);

  // ── 7. New Problem Zone ────────────────────────────────────────────────────
  // Target patterns = neglected from coach; if none, fall back to top-3 weakest.
  const targetPatterns: CanonicalPattern[] =
    neglected.length > 0
      ? (neglected as CanonicalPattern[])
      : CANONICAL_PATTERNS.slice()
          .sort((a, b) => {
            const wa = weaknessFromMastery(defaultMastery(a).rating, defaultMastery(a).rd);
            const wb = weaknessFromMastery(defaultMastery(b).rating, defaultMastery(b).rd);
            return wb - wa;
          })
          .slice(0, 3);

  const targetPatternSet = new Set<string>(targetPatterns);

  // ZPD difficulty target per pattern (rd-adaptive, success-targeted, with
  // empirical-Bayes transfer for cold patterns).
  const zpdTargetByPattern = new Map<string, ZpdTarget>(
    targetPatterns.map((p) => [p, zpdTargetFor(p)]),
  );

  type ScoredBankItem = NewProblemItem & { _overlap: number; _score: number };

  // Continuous fit replaces the brittle `difficulty === bucket` equality filter:
  // a problem is scored by patternPriority × how close its difficulty (real Elo
  // → acceptance pseudo-Elo → categorical) sits to the pattern's ZPD target.
  const scoredBank: ScoredBankItem[] = (bankRes.data ?? [])
    .flatMap((b): ScoredBankItem[] => {
      if (b.leetcode_url && userProblemUrls.has(b.leetcode_url)) return [];

      const overlapPatterns = ((b.patterns as string[] | null) ?? []).filter((p) =>
        targetPatternSet.has(p),
      );
      if (overlapPatterns.length === 0) return [];

      const signal = problemSignal(b);

      let bestPat = overlapPatterns[0];
      let bestScore = 0;
      for (const p of overlapPatterns) {
        const cp = p as CanonicalPattern;
        const gap = coverageGapForPattern(cp, target, actual);
        const pp = patternPriority(defaultMastery(cp), cp, gap);
        const tgt = zpdTargetByPattern.get(p);
        const fit = tgt ? scoreProblemFit(signal, tgt) : 0;
        const combined = pp * fit;
        if (combined > bestScore) { bestScore = combined; bestPat = p; }
      }

      return [
        {
          bank_id: b.id,
          slug: b.slug,
          title: b.title,
          difficulty: b.difficulty,
          patterns: (b.patterns as string[] | null) ?? [],
          leetcode_url: b.leetcode_url,
          target_pattern: bestPat,
          est_minutes: NEW_PROBLEM_MINUTES[b.difficulty] ?? 45,
          _overlap: overlapPatterns.length,
          _score: bestScore,
        },
      ];
    })
    .sort((a, b) => b._score - a._score || b._overlap - a._overlap);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const newProblemItems: NewProblemItem[] = scoredBank
    .slice(0, 3)
    .map(({ _overlap: _o, _score: _s, ...item }) => item);

  // ── 8. Zone allocation, redistribution, and fill ──────────────────────────
  const rawAlloc = apportionTotal(dsaGoal, [
    dsaPrefs.recognition_drill,
    dsaPrefs.re_solve,
    dsaPrefs.new_problem,
  ]);

  const [allocDrill, allocResolve, allocNew] = redistributeDsaMinutes(
    [rawAlloc[0], rawAlloc[1], rawAlloc[2]],
    [
      interleavedDrill.length === 0,
      resolveItems.length === 0,
      newProblemItems.length === 0,
    ],
  );

  const drillFill = fillBudget(interleavedDrill, allocDrill);
  const resolveFill = fillBudget(resolveItems, allocResolve);
  // New problem overflows are not deferred — they're just not suggested today.
  const newFill = fillBudget(newProblemItems, allocNew);

  // ── 9. Assemble output ─────────────────────────────────────────────────────
  return {
    data: {
      plan_date: today,
      zones: {
        recognition_drill: {
          allocated_minutes: allocDrill,
          items: drillFill.items,
        },
        re_solve: {
          allocated_minutes: allocResolve,
          items: resolveFill.items,
        },
        new_problem: {
          allocated_minutes: allocNew,
          items: newFill.items,
        },
      },
      coach: coachBlock,
      global_skill: globalSkill,
      deferred: [...drillFill.deferred, ...resolveFill.deferred],
    },
    error: null,
  };
}
