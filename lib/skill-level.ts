/**
 * lib/skill-level.ts
 *
 * Global DSA skill level + empirical-Bayes cold-start prior.
 *
 * The per-pattern Glicko-2 ratings (lib/pattern-rating.ts) tell us how good the
 * learner is at each of 25 patterns, with an uncertainty (rd). This module
 * answers two higher-level questions the per-pattern model can't:
 *
 *  1. "What is my OVERALL level — beginner / intermediate / advanced?"
 *     → computeGlobalSkill: an inverse-variance (precision-weighted) pool of the
 *       pattern ratings, so confident patterns dominate and noisy ones barely
 *       count. Labelled with hysteresis so it doesn't flicker between sessions.
 *
 *  2. "I've barely touched this pattern — what difficulty should I see?"
 *     → effectiveRating: shrink a high-uncertainty pattern toward the learner's
 *       global ability (cross-pattern transfer) instead of the meaningless 1500
 *       default. A strong learner is not treated as average on a new pattern.
 *
 * All functions are pure (no DB, no IO). effectiveRating is a READ-TIME lens for
 * problem selection only — it is never written back into pattern_mastery and
 * never feeds the Glicko update loop.
 */

import {
  CANONICAL_PATTERNS,
  PATTERN_IMPORTANCE,
  type CanonicalPattern,
} from "@/lib/pattern-map";

// ─── constants ─────────────────────────────────────────────────────────────

const DEFAULT_RATING = 1500;
const DEFAULT_RD = 350;

/** rd at/below which a pattern estimate counts as "confident" for the level. */
const CONFIDENT_RD = 150;
/** Rating/rd thresholds for counting a pattern as "mastered" (match weakness §). */
const MASTERY_RATING = 1650;
const MASTERY_RD = 200;
/** Floor on rd inside precision weights — divide-by-zero / runaway-weight guard. */
const RD_FLOOR = 30;

/** Level band boundaries on the Glicko scale. */
const BEGINNER_CEIL = 1450; // < 1450 → beginner core
const ADVANCED_FLOOR = 1700; // ≥ 1700 → advanced core; middle = intermediate
/** A label only changes when the rating crosses a boundary by this margin. */
const HYSTERESIS = 40;

/** Below this much confident signal (or breadth) we stay "calibrating". */
const MIN_CONFIDENCE = 0.15;
const MIN_BREADTH_ATTEMPTED = 4;

// ─── public types ──────────────────────────────────────────────────────────

export type SkillLevelLabel = "beginner" | "intermediate" | "advanced";
/** "calibrating" = not enough confident signal to assign a real level yet. */
export type SkillLevelState = SkillLevelLabel | "calibrating";

const CANONICAL_SET = new Set<string>(CANONICAL_PATTERNS);

export interface PatternMasteryInput {
  pattern: string; // canonical; non-canonical rows are ignored
  rating: number;
  rd: number;
  attempts: number; // pattern_mastery.attempts
}

export interface GlobalSkill {
  /** Inverse-variance (precision) weighted global rating on the Glicko scale. */
  globalRating: number;
  /** Aggregate uncertainty of the global estimate (Glicko-scale rd). */
  globalRd: number;
  /** Hysteretic label; "calibrating" until there is enough confident signal. */
  level: SkillLevelState;
  /** 0..1 — fraction of total precision coming from confident patterns. */
  confidence: number;
  /** Patterns with ≥1 attempt, out of 25. */
  breadthAttempted: number;
  /** Patterns with rating ≥ MASTERY_RATING && rd ≤ MASTERY_RD, out of 25. */
  breadthMastered: number;
  /** Highest difficulty (Elo) the learner has demonstrably handled. */
  ceilingElo: number;
}

export interface ComputeGlobalSkillOptions {
  /** Previously-stored label (users.settings.skill_level_cache) for hysteresis. */
  previousLevel?: SkillLevelState;
  /** Externally-derived demonstrated ceiling (e.g. insights difficulty_ceiling). */
  demonstratedCeilingElo?: number;
}

// ─── 1. Global skill ───────────────────────────────────────────────────────

function precision(rd: number): number {
  const r = Math.max(rd, RD_FLOOR);
  return 1 / (r * r);
}

/**
 * Pool the per-pattern ratings into one global skill estimate. Only patterns the
 * learner has actually ATTEMPTED contribute — defaulting untouched patterns to
 * 1500/350 and pooling them would fabricate confidence, so they are excluded
 * (an untouched pattern is "unknown", not "average").
 *
 *   wᵢ            = precision(rdᵢ) · (0.5 + 0.5·importanceᵢ)
 *   globalRating  = Σ wᵢ·ratingᵢ / Σ wᵢ
 *   globalRd      = sqrt(1 / Σ precision(rdᵢ))      // importance-neutral
 *   confidence    = Σ_{rdᵢ ≤ CONFIDENT_RD} precision(rdᵢ) / Σ precision(rdᵢ)
 */
export function computeGlobalSkill(
  rows: PatternMasteryInput[],
  opts: ComputeGlobalSkillOptions = {},
): GlobalSkill {
  const attempted = rows.filter(
    (r) =>
      CANONICAL_SET.has(r.pattern) &&
      r.attempts > 0 &&
      Number.isFinite(r.rating) &&
      Number.isFinite(r.rd),
  );

  let sumW = 0;
  let sumWRating = 0;
  let sumPrecision = 0;
  let sumConfidentPrecision = 0;
  let breadthAttempted = 0;
  let breadthMastered = 0;
  let maxConfidentRating = Number.NEGATIVE_INFINITY;

  for (const row of attempted) {
    const imp = PATTERN_IMPORTANCE[row.pattern as CanonicalPattern] ?? 0.5;
    const p = precision(row.rd);
    const w = p * (0.5 + 0.5 * imp);

    sumW += w;
    sumWRating += w * row.rating;
    sumPrecision += p;
    breadthAttempted += 1;

    if (row.rd <= CONFIDENT_RD) {
      sumConfidentPrecision += p;
      if (row.rating > maxConfidentRating) maxConfidentRating = row.rating;
    }
    if (row.rating >= MASTERY_RATING && row.rd <= MASTERY_RD) {
      breadthMastered += 1;
    }
  }

  // No real evidence yet → fully uncertain, calibrating.
  if (sumW === 0 || sumPrecision === 0) {
    return {
      globalRating: DEFAULT_RATING,
      globalRd: DEFAULT_RD,
      level: "calibrating",
      confidence: 0,
      breadthAttempted: 0,
      breadthMastered: 0,
      ceilingElo: opts.demonstratedCeilingElo ?? DEFAULT_RATING,
    };
  }

  const globalRating = sumWRating / sumW;
  const globalRd = Math.sqrt(1 / sumPrecision);
  const confidence = sumConfidentPrecision / sumPrecision;
  const ceilingElo =
    opts.demonstratedCeilingElo ??
    (maxConfidentRating > Number.NEGATIVE_INFINITY
      ? maxConfidentRating
      : globalRating);

  const level = assignLevel(
    globalRating,
    confidence,
    breadthAttempted,
    opts.previousLevel,
  );

  return {
    globalRating,
    globalRd,
    level,
    confidence,
    breadthAttempted,
    breadthMastered,
    ceilingElo,
  };
}

const RANK: Record<SkillLevelLabel, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
};

function coreLabel(rating: number): SkillLevelLabel {
  if (rating < BEGINNER_CEIL) return "beginner";
  if (rating >= ADVANCED_FLOOR) return "advanced";
  return "intermediate";
}

/**
 * Assign the level label, applying hysteresis against the previous label so the
 * level doesn't flap when the rating hovers on a boundary. Promotion from
 * "calibrating" (or no prior) uses the bare core thresholds; switching between
 * two real labels requires crossing the boundary by ≥ HYSTERESIS.
 */
function assignLevel(
  rating: number,
  confidence: number,
  breadthAttempted: number,
  previousLevel?: SkillLevelState,
): SkillLevelState {
  if (confidence < MIN_CONFIDENCE || breadthAttempted < MIN_BREADTH_ATTEMPTED) {
    return "calibrating";
  }

  const core = coreLabel(rating);
  if (!previousLevel || previousLevel === "calibrating") return core;
  if (core === previousLevel) return previousLevel;

  if (RANK[core] > RANK[previousLevel]) {
    // Promotion — demand a firm crossing into the higher band.
    if (rating >= ADVANCED_FLOOR + HYSTERESIS) return "advanced";
    if (
      previousLevel === "beginner" &&
      rating >= BEGINNER_CEIL + HYSTERESIS
    ) {
      return "intermediate";
    }
    return previousLevel;
  }

  // Demotion — demand a firm crossing into the lower band.
  if (rating <= BEGINNER_CEIL - HYSTERESIS) return "beginner";
  if (previousLevel === "advanced" && rating <= ADVANCED_FLOOR - HYSTERESIS) {
    return "intermediate";
  }
  return previousLevel;
}

// ─── 2. Empirical-Bayes effective rating (cold-start transfer) ─────────────

/**
 * Shrink a pattern's estimate toward the learner's global ability, weighted by
 * precision. A confident pattern (small rd) barely moves; a never-seen one
 * (rd≈350) is pulled most of the way to the global rating — so a strong learner
 * is challenged appropriately on a brand-new pattern instead of being reset to
 * 1500. READ-TIME ONLY — never write this back to pattern_mastery.
 *
 *   τ_pat  = precision(rd);  τ_glob = precision(globalRd)
 *   rating = (τ_pat·rating + τ_glob·globalRating) / (τ_pat + τ_glob)
 *   rd     = sqrt(1 / (τ_pat + τ_glob))
 */
export function effectiveRating(
  pattern: { rating: number; rd: number },
  globalRating: number,
  globalRd: number,
): { rating: number; rd: number } {
  const tauPat = precision(pattern.rd);
  const tauGlob = precision(globalRd);
  const sum = tauPat + tauGlob;
  return {
    rating: (tauPat * pattern.rating + tauGlob * globalRating) / sum,
    rd: Math.sqrt(1 / sum),
  };
}
