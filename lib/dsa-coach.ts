/**
 * DSA Coach — pure pattern-rebalancing functions.
 *
 * Implements §7 (PatternPriority) and §8 (anti-overindexing / portfolio
 * rebalancing) from docs/masteryos-dsa-mastery-spec.md.
 *
 * All functions are pure: no DB calls, no IO. Pass pre-fetched data in.
 */

import {
  CANONICAL_PATTERNS,
  PATTERN_IMPORTANCE,
  type CanonicalPattern,
} from "@/lib/pattern-map";
import { weaknessFromMastery } from "@/lib/pattern-rating";

// ─── constants ───────────────────────────────────────────────────────────────

const DEFAULT_RATING = 1500;
const DEFAULT_RD = 350;

/** Absolute drift threshold (share-point) to classify a pattern as neglected or
 *  over-practiced. At 25 patterns the uniform share ≈ 0.04, so 0.03 is a
 *  meaningful deviation without being hair-trigger. */
const DRIFT_THRESHOLD = 0.03;

/** Maximum number of patterns returned in each drift bucket. */
const TOP_K = 3;

// ─── public types ────────────────────────────────────────────────────────────

/** Glicko-2 mastery snapshot for a single (user, pattern) row. */
export interface MasterySnapshot {
  rating: number;
  rd: number;
}

/** Minimal slice of a `problem_attempts` row needed for distribution math. */
export interface Attempt {
  /** Canonical patterns credited to this attempt. */
  patterns: string[];
  /** ISO 8601 timestamp (from DB created_at). */
  created_at: string;
}

// ─── 1. Pattern priority (§7) ────────────────────────────────────────────────

/**
 * Score how urgently a pattern should be worked next.
 *
 *   Weakness = weaknessFromMastery(rating, rd)   — §4.4
 *   F        = PATTERN_IMPORTANCE[pattern]        — interview/foundational weight
 *   G        = coverageGap ∈ [0,1]               — how under-practiced vs target
 *
 *   PatternPriority = Weakness × (0.15 + 0.85·(0.6·F + 0.4·G))
 *
 * The 0.15 floor ensures even a fully mastered pattern never scores zero, so
 * important patterns remain in rotation.
 */
export function patternPriority(
  mastery: MasterySnapshot,
  pattern: CanonicalPattern,
  coverageGap: number,
): number {
  const weakness = weaknessFromMastery(mastery.rating, mastery.rd);
  const F = PATTERN_IMPORTANCE[pattern];
  const G = Math.max(0, Math.min(1, coverageGap));
  return weakness * (0.15 + 0.85 * (0.6 * F + 0.4 * G));
}

// ─── 2. Target distribution (§8 step 1) ──────────────────────────────────────

/**
 * Compute each pattern's deserved share of practice this week by normalizing
 * PatternPriority (with coverageGap=0) across all 25 canonical patterns.
 *
 * Patterns missing from `masteryByPattern` are treated as fully uncertain
 * (default rating=1500, rd=350 — the Glicko-2 starting point).
 *
 * If every pattern scores 0 (perfect mastery across the board), fall back to a
 * uniform distribution so the planner always has something to suggest.
 */
export function targetDistribution(
  masteryByPattern: Map<CanonicalPattern, MasterySnapshot>,
): Map<CanonicalPattern, number> {
  const priorities = new Map<CanonicalPattern, number>();
  let total = 0;

  for (const pattern of CANONICAL_PATTERNS) {
    const mastery = masteryByPattern.get(pattern) ?? {
      rating: DEFAULT_RATING,
      rd: DEFAULT_RD,
    };
    const p = patternPriority(mastery, pattern, 0);
    priorities.set(pattern, p);
    total += p;
  }

  const result = new Map<CanonicalPattern, number>();

  if (total === 0) {
    const even = 1 / CANONICAL_PATTERNS.length;
    for (const pattern of CANONICAL_PATTERNS) {
      result.set(pattern, even);
    }
  } else {
    for (const [pattern, p] of priorities) {
      result.set(pattern, p / total);
    }
  }

  return result;
}

// ─── 3. Actual distribution (§8 step 2) ──────────────────────────────────────

/**
 * Measure each pattern's share of practice credits in the last `windowDays`
 * days. Each attempt contributes one credit to every pattern it tags.
 *
 * All 25 canonical patterns are always present in the returned Map (unvisited
 * patterns receive 0). If no attempts fall inside the window, every pattern
 * gets 0.
 *
 * @param attempts   Rows from `problem_attempts` (any recency — filtering is internal).
 * @param windowDays Rolling window length; default 14.
 * @param nowMs      Current epoch milliseconds; injectable for tests.
 */
export function actualDistribution(
  attempts: Attempt[],
  windowDays = 14,
  nowMs = Date.now(),
): Map<string, number> {
  const cutoffMs = nowMs - windowDays * 86_400_000;

  const counts = new Map<string, number>();
  let total = 0;

  for (const attempt of attempts) {
    if (new Date(attempt.created_at).getTime() < cutoffMs) continue;
    for (const pattern of attempt.patterns) {
      counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
      total++;
    }
  }

  const result = new Map<string, number>();

  for (const pattern of CANONICAL_PATTERNS) {
    const count = counts.get(pattern) ?? 0;
    result.set(pattern, total > 0 ? count / total : 0);
  }

  return result;
}

// ─── 4. Drift classification (§8 step 3) ─────────────────────────────────────

/**
 * Identify the most neglected and most over-practiced patterns.
 *
 * Drift per pattern = actual_share − target_share.
 * - Neglected:      drift ≤ −DRIFT_THRESHOLD (under-practiced vs target)
 * - Over-practiced: drift ≥ +DRIFT_THRESHOLD (over-practiced vs target)
 *
 * Returns at most TOP_K patterns per bucket, sorted by magnitude.
 */
export function computeDrift(
  target: Map<string, number>,
  actual: Map<string, number>,
): { neglected: string[]; overPracticed: string[] } {
  const allPatterns = new Set([...target.keys(), ...actual.keys()]);

  const drifts: Array<{ pattern: string; drift: number }> = [];
  for (const pattern of allPatterns) {
    drifts.push({
      pattern,
      drift: (actual.get(pattern) ?? 0) - (target.get(pattern) ?? 0),
    });
  }

  const neglected = drifts
    .filter((d) => d.drift < -DRIFT_THRESHOLD)
    .sort((a, b) => a.drift - b.drift) // most negative first
    .slice(0, TOP_K)
    .map((d) => d.pattern);

  const overPracticed = drifts
    .filter((d) => d.drift > DRIFT_THRESHOLD)
    .sort((a, b) => b.drift - a.drift) // most positive first
    .slice(0, TOP_K)
    .map((d) => d.pattern);

  return { neglected, overPracticed };
}

// ─── 5. Balance score (§8) ───────────────────────────────────────────────────

/**
 * Single metric summarising how balanced practice is this week.
 *
 *   balanceScore = 1 − normalizedGini(|drift|)
 *
 * Perfect balance → 1.0. All practice on one pattern → 0.0.
 *
 * The normalized Gini divides the raw Gini coefficient by its maximum possible
 * value ((n−1)/n) so the score uses the full [0,1] range regardless of how many
 * patterns are tracked.
 */
export function balanceScore(
  target: Map<string, number>,
  actual: Map<string, number>,
): number {
  const patterns = [...target.keys()];
  if (patterns.length === 0) return 1;

  const absDrifts = patterns.map((p) =>
    Math.abs((actual.get(p) ?? 0) - (target.get(p) ?? 0)),
  );

  const g = giniCoefficient(absDrifts);
  const maxGini = (patterns.length - 1) / patterns.length;
  const normalizedGini = maxGini > 0 ? g / maxGini : 0;

  return Math.max(0, 1 - normalizedGini);
}

// ─── Gini helper ─────────────────────────────────────────────────────────────

/** Gini coefficient for a set of non-negative values via the Lorenz-curve formula. */
function giniCoefficient(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  if (mean === 0) return 0;

  let numerator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (2 * (i + 1) - n - 1) * sorted[i];
  }

  return numerator / (n * n * mean);
}
