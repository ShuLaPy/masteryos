import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  TypeConvert,
  type Card,
  type RecordLogItem,
  type Grade,
} from "ts-fsrs";

// Initialize FSRS with default parameters (can be personalized per user later)
const params = generatorParameters({ enable_fuzz: true });
const f = fsrs(params);

export { Rating };
export type { Card };

// Map numeric State enum to DB text values
const stateToText: Record<number, string> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};

/**
 * Create a brand-new SRS card with default state
 */
export function newCard(): Card {
  return createEmptyCard();
}

/**
 * Process a review and return the updated card state + scheduling info
 * @param card - Current card state from DB
 * @param rating - 1=Again, 2=Hard, 3=Good, 4=Easy
 */
export function reviewCard(
  card: Card,
  rating: Rating
): { updatedCard: Card; log: RecordLogItem } {
  const now = new Date();
  const schedulingCards = f.repeat(card, now);
  const result = schedulingCards[rating as unknown as Grade];
  return {
    updatedCard: result.card,
    log: result,
  };
}

/**
 * Get retrievability (probability of recall) for a card right now
 * Returns 0-1 (0 = forgotten, 1 = definitely remembered)
 */
export function getRetrievability(card: Card): number {
  if (card.stability === 0) return 1; // New card — not yet tested
  const daysSinceReview = card.last_review
    ? (Date.now() - new Date(card.last_review).getTime()) / (1000 * 60 * 60 * 24)
    : 0;
  // FSRS formula: R(t) = (1 + t / (9 * S))^(-1)
  return Math.pow(1 + daysSinceReview / (9 * card.stability), -1);
}

/**
 * Convert a DB card record to ts-fsrs Card type.
 * Handles the state text→enum conversion and missing learning_steps field.
 */
export function dbCardToFSRS(dbCard: {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: string;
  last_review: string | null;
  learning_steps?: number;
}): Card {
  return {
    due: new Date(dbCard.due),
    stability: dbCard.stability,
    difficulty: dbCard.difficulty,
    elapsed_days: dbCard.elapsed_days,
    scheduled_days: dbCard.scheduled_days,
    reps: dbCard.reps,
    lapses: dbCard.lapses,
    state: TypeConvert.state(dbCard.state),
    last_review: dbCard.last_review ? new Date(dbCard.last_review) : undefined,
    learning_steps: dbCard.learning_steps ?? 0,
  };
}

/**
 * Convert ts-fsrs Card back to DB-friendly fields.
 * Converts numeric state enum back to text for storage.
 */
export function fsrsCardToDB(card: Card) {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: stateToText[card.state as number] ?? "new",
    last_review: card.last_review?.toISOString() ?? null,
  };
}

/**
 * Get label for a rating number
 */
export function getRatingLabel(rating: number): string {
  const labels: Record<number, string> = {
    1: "Again",
    2: "Hard",
    3: "Good",
    4: "Easy",
  };
  return labels[rating] ?? "Unknown";
}

/**
 * Get color class for retrievability score
 */
export function getRetentionColor(retention: number): string {
  if (retention >= 0.85) return "text-emerald-400";
  if (retention >= 0.65) return "text-amber-400";
  if (retention >= 0.4) return "text-orange-400";
  return "text-red-400";
}
