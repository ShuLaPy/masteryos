/**
 * lib/zpd.ts
 *
 * Zone-of-Proximal-Development problem targeting — the intelligence layer that
 * decides *how hard* the next problem should be for a given pattern, and how
 * well a candidate problem fits that target.
 *
 * This replaces the old 3-bucket `zpdDifficulty(rating)` with a continuous,
 * uncertainty-aware, success-targeted model grounded in learning science:
 *
 *  - The "85% Rule" (Wilson, Shenhav, Straccia & Cohen, Nature Communications
 *    2019): learning is fastest at ~85% training accuracy. So when we KNOW the
 *    learner's level on a pattern, aim for ~85% predicted success.
 *  - Maths Garden / Klinkenberg (2011) & Pelánek's Elo-in-education: put learner
 *    ability and item difficulty on ONE Elo scale and sample at a target success
 *    probability. We invert the Elo expected-score curve to get the target item
 *    difficulty for a chosen success probability.
 *  - ZPD / desirable difficulty (Metcalfe; Bjork): when we are UNCERTAIN about
 *    the learner (high Glicko rd) the most useful problem is a near-peer probe
 *    (~55% success — maximally diagnostic). As certainty grows we shift to the
 *    ~85% growth zone.
 *
 * All functions here are pure (no DB, no IO). Reuses the Glicko scale +
 * difficulty mapping from lib/pattern-rating.ts — no duplicated math.
 */

import { difficultyToRating, type Difficulty } from "@/lib/pattern-rating";

// ─── Tunable constants ─────────────────────────────────────────────────────

/** Base growth target — the "85% Rule". Overridable per-user via settings. */
export const DEFAULT_TARGET_SUCCESS = 0.85;

/** Most-diagnostic target success when the learner's level is maximally unknown. */
const DIAGNOSTIC_SUCCESS = 0.55;

/** Glicko rd of a freshly-measured pattern (full confidence). Matches PHI_FRESH. */
const RD_FRESH = 50;
/** Glicko rd of a never-seen / fully-decayed pattern. Matches RD_MAX. */
const RD_MAX = 350;

/** Elo logistic scale (chess / Maths-Garden convention). */
const ELO_SCALE = 400;

/** Clamp target success away from 0/1 so the logit inversion never blows up. */
const P_MIN = 0.5;
const P_MAX = 0.92;

/**
 * Opponent "centres" that tie the categorical difficulty buckets to the Glicko
 * scale (easy=1300, medium=1550, hard=1800). Boundaries for the categorical
 * fallback are the midpoints: <1425 → easy, <1675 → medium, else hard.
 */
const EASY_MEDIUM_BOUNDARY = (1300 + 1550) / 2; // 1425
const MEDIUM_HARD_BOUNDARY = (1550 + 1800) / 2; // 1675

/** Width (Elo) of the Gaussian used to score how well a problem fits the target. */
const FIT_SIGMA = 120;

/**
 * Median LeetCode acceptance rate per categorical band (fraction 0..1), used to
 * centre the acceptance→pseudo-Elo fallback. Derived from the seed dataset.
 */
const BAND_MEDIAN_ACCEPTANCE: Record<Difficulty, number> = {
  easy: 0.62,
  medium: 0.47,
  hard: 0.37,
};

/** Max Elo a pseudo-Elo may stray from its band centre (keeps bands ordered). */
const ACCEPTANCE_PSEUDO_ELO_SPREAD = 125;
/** Sensitivity of pseudo-Elo to acceptance deviation from the band median. */
const ACCEPTANCE_PSEUDO_ELO_GAIN = 250;

// ─── Helpers ───────────────────────────────────────────────────────────────

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Predicted probability the learner (ability `rating`) solves an item of
 * difficulty `elo`, on the shared Elo scale. P=0.5 when elo === rating; higher
 * when the item is easier than the learner. Standard Elo expected-score curve.
 */
export function predictedSuccess(rating: number, elo: number): number {
  return 1 / (1 + Math.pow(10, (elo - rating) / ELO_SCALE));
}

/** Map a target Elo to the categorical band (fallback when a problem has no Elo). */
export function bandForElo(targetElo: number): Difficulty {
  if (targetElo < EASY_MEDIUM_BOUNDARY) return "easy";
  if (targetElo < MEDIUM_HARD_BOUNDARY) return "medium";
  return "hard";
}

// ─── Public types ──────────────────────────────────────────────────────────

export interface ZpdTarget {
  /** Target item difficulty on the Glicko/Elo scale. */
  targetElo: number;
  /** The success probability we aimed for (after rd-adaptation + clamp). */
  targetSuccess: number;
  /** Categorical fallback band (when a candidate problem lacks a real Elo). */
  band: Difficulty;
}

export interface ZpdTargetOptions {
  /** Per-user growth target success (users.settings.zpd_target_success). */
  baseTargetSuccess?: number;
  /**
   * Legacy mode reproduces the old `rating + 125` target exactly, so display
   * surfaces (heatmap/insights tooltips) that call the `zpdDifficulty` shim
   * keep their historical bands. New SELECTION sites should leave this false.
   */
  legacy?: boolean;
}

// ─── 1. ZPD target ─────────────────────────────────────────────────────────

/**
 * Compute the ZPD difficulty target for a pattern from its Glicko mastery.
 *
 * Growth target p* adapts to uncertainty:
 *   u  = clamp((rd − RD_FRESH) / (RD_MAX − RD_FRESH), 0, 1)   // 0 = sure, 1 = unknown
 *   p* = (1 − u)·pGrowth + u·DIAGNOSTIC_SUCCESS               // confident→0.85, unsure→0.55
 *   p* = clamp(p*, P_MIN, P_MAX)
 *
 * Target item difficulty inverts the Elo success curve:
 *   targetElo = rating + ELO_SCALE · log10(1/p* − 1)
 *   (p*=0.85 → rating − 301; p*=0.55 → rating − 35.)
 */
export function zpdTarget(
  mastery: { rating: number; rd: number },
  opts: ZpdTargetOptions = {},
): ZpdTarget {
  const { rating, rd } = mastery;

  if (opts.legacy) {
    // Historical behaviour: target = rating + 125, bucketed at 1425/1675.
    const targetElo = rating + 125;
    return {
      targetElo,
      targetSuccess: predictedSuccess(rating, targetElo),
      band: bandForElo(targetElo),
    };
  }

  const pGrowth = clamp(
    opts.baseTargetSuccess ?? DEFAULT_TARGET_SUCCESS,
    P_MIN,
    P_MAX,
  );

  const u = clamp((rd - RD_FRESH) / (RD_MAX - RD_FRESH), 0, 1);
  const targetSuccess = clamp(
    (1 - u) * pGrowth + u * DIAGNOSTIC_SUCCESS,
    P_MIN,
    P_MAX,
  );

  const targetElo = rating + ELO_SCALE * Math.log10(1 / targetSuccess - 1);

  return { targetElo, targetSuccess, band: bandForElo(targetElo) };
}

// ─── 2. Problem difficulty signal → Elo ────────────────────────────────────

/**
 * A problem's difficulty signal, in descending order of fidelity:
 *  - `elo`         — a curated per-problem rating (problem_bank.elo_rating).
 *  - `acceptance`  — LeetCode acceptance rate + its categorical band.
 *  - `categorical` — only the easy/medium/hard label.
 */
export type ProblemDifficultySignal =
  | { kind: "elo"; elo: number }
  | { kind: "acceptance"; acceptance: number; categorical: Difficulty }
  | { kind: "categorical"; categorical: Difficulty };

/**
 * Build the best available difficulty signal from a problem_bank-shaped row.
 * Prefers a real Elo, then acceptance+band, then the bare categorical label.
 */
export function problemSignal(row: {
  elo_rating?: number | null;
  acceptance_rate?: number | null;
  difficulty: string;
}): ProblemDifficultySignal {
  const categorical = normalizeDifficulty(row.difficulty);
  if (typeof row.elo_rating === "number" && Number.isFinite(row.elo_rating)) {
    return { kind: "elo", elo: row.elo_rating };
  }
  if (
    typeof row.acceptance_rate === "number" &&
    Number.isFinite(row.acceptance_rate)
  ) {
    return { kind: "acceptance", acceptance: row.acceptance_rate, categorical };
  }
  return { kind: "categorical", categorical };
}

function normalizeDifficulty(d: string): Difficulty {
  return d === "easy" || d === "hard" ? d : "medium";
}

/** Resolve a single Elo value for any difficulty signal (graceful degradation). */
export function problemElo(signal: ProblemDifficultySignal): number {
  switch (signal.kind) {
    case "elo":
      return signal.elo;
    case "acceptance": {
      const center = difficultyToRating(signal.categorical);
      const median = BAND_MEDIAN_ACCEPTANCE[signal.categorical];
      // Lower acceptance ⇒ harder ⇒ higher pseudo-Elo. Clamped within the band.
      const delta = clamp(
        ACCEPTANCE_PSEUDO_ELO_GAIN * (median - signal.acceptance),
        -ACCEPTANCE_PSEUDO_ELO_SPREAD,
        ACCEPTANCE_PSEUDO_ELO_SPREAD,
      );
      return center + delta;
    }
    case "categorical":
      return difficultyToRating(signal.categorical);
  }
}

// ─── 3. Fit score ──────────────────────────────────────────────────────────

/**
 * How well a candidate problem matches the ZPD target — a Gaussian on the Elo
 * gap in (0, 1]. 1.0 = exactly on target; falls off smoothly with distance.
 * Selection sites multiply this into patternPriority so a near-target problem
 * in an important/neglected pattern wins.
 */
export function scoreProblemFit(
  signal: ProblemDifficultySignal,
  target: ZpdTarget,
): number {
  const gap = problemElo(signal) - target.targetElo;
  return Math.exp(-Math.pow(gap / FIT_SIGMA, 2));
}
