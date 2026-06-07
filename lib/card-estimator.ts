/**
 * Per-card time estimation for capacity-aware zone filling
 * (docs/bridge-runway-spec.md §5.1).
 *
 * The planner cannot allocate "20 minutes to Runway" without knowing how long
 * each card takes, so we estimate minutes from FSRS state. State is read from the
 * lowercase text the DB stores ('new' | 'learning' | 'review' | 'relearning'),
 * matching lib/fsrs.ts's dbCardToFSRS() convention — never the numeric ts-fsrs
 * enum. Estimates are deliberately coarse; they drive greedy truncation, not
 * billing.
 */

import type { Tables } from "@/types/database";

type SrsCard = Tables<"srs_cards">;

/** New/learning/relearning cards involve fresh effort → fixed estimate. */
const LEARNING_MINUTES = 1.5;

/** One-time cold-start primer task (spec §6) → fixed estimate. */
const COLD_START_PRIMER_MINUTES = 5.0;

/** Review cards scale with difficulty, bounded to this range. */
const REVIEW_MIN_MINUTES = 0.5;
const REVIEW_MAX_MINUTES = 1.0;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Estimate the minutes a single card will take to review (spec §5.1).
 *
 * - cold-start primer (`source_type === 'cold_start_primer'`) → 5.0 (one-time)
 * - 'new' | 'learning' | 'relearning'                         → 1.5
 * - 'review' → 0.5 + 0.5·(difficulty / 10), clamped to [0.5, 1.0]
 *
 * Cold-start primers are checked first since their effort is independent of FSRS
 * state. Unknown states fall back to the learning estimate (conservative).
 */
export function estimateCardMinutes(card: SrsCard): number {
  if (card.source_type === "cold_start_primer") {
    return COLD_START_PRIMER_MINUTES;
  }

  switch (card.state) {
    case "review":
      return clamp(
        0.5 + 0.5 * (card.difficulty / 10),
        REVIEW_MIN_MINUTES,
        REVIEW_MAX_MINUTES
      );
    case "new":
    case "learning":
    case "relearning":
    default:
      return LEARNING_MINUTES;
  }
}
