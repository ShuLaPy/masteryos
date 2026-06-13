/**
 * Derivation cards (roadmap Phase 1b, goal 4 — "master the math behind it").
 *
 * A derivation card asks the student to reproduce a multi-step derivation/proof
 * from a stated goal. It is an ordinary `srs_cards` row with `card_type='derivation'`
 * whose structured body lives in the `payload` jsonb column (see the
 * 20260613090000_derivation_cards migration). `front`/`back` still carry a
 * human-readable summary so anything that renders a plain card (search, the
 * weekly review, etc.) degrades gracefully without understanding payloads.
 *
 * This module is pure (no Supabase/AI) so it can be reused by the API route, the
 * card estimator, and the review UI alike.
 */

/** One step of a derivation: a LaTeX line plus a one-sentence justification. */
export interface DerivationStep {
  /** The step itself as a LaTeX expression (no surrounding `$`). */
  latex: string;
  /** Why this step is valid — one sentence, plain prose (may contain `$…$`). */
  explanation: string;
}

/** Structured body stored in `srs_cards.payload` for `card_type='derivation'`. */
export interface DerivationPayload {
  /** What the student must arrive at, as LaTeX (no surrounding `$`). */
  goal_latex: string;
  /** Ordered steps from premises to goal. */
  steps: DerivationStep[];
  /** Optional source section (e.g. a lecture title or paper section path). */
  source_section: string | null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate/normalize an untrusted value (DB jsonb or AI output) into a
 * {@link DerivationPayload}. Returns null when the shape is invalid so callers
 * can skip rather than crash — mirrors the defensive parsing in
 * lib/interview-engine.ts (`normalizeSlotGrade`) and lib/accountability.ts.
 */
export function parseDerivationPayload(raw: unknown): DerivationPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  if (!isNonEmptyString(obj.goal_latex)) return null;
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) return null;

  const steps: DerivationStep[] = [];
  for (const step of obj.steps) {
    if (!step || typeof step !== "object") return null;
    const s = step as Record<string, unknown>;
    if (!isNonEmptyString(s.latex)) return null;
    steps.push({
      latex: s.latex.trim(),
      explanation: isNonEmptyString(s.explanation) ? s.explanation.trim() : "",
    });
  }

  return {
    goal_latex: obj.goal_latex.trim(),
    steps,
    source_section: isNonEmptyString(obj.source_section)
      ? obj.source_section.trim()
      : null,
  };
}

/** Minimum/maximum minutes a derivation card review may be estimated at. */
export const DERIVATION_MIN_MINUTES = 3.0;
export const DERIVATION_MAX_MINUTES = 6.0;

/**
 * Estimate minutes to review a derivation card from its step count
 * (roadmap Phase 1b): a base 2 min plus 0.5 min/step, clamped to [3, 6].
 * Reproducing a derivation is inherently slower than a recall card, so the floor
 * sits above the prose-card learning estimate (1.5 min in lib/card-estimator.ts).
 */
export function derivationCardMinutes(stepCount: number): number {
  const raw = 2.0 + 0.5 * Math.max(0, stepCount);
  return Math.min(DERIVATION_MAX_MINUTES, Math.max(DERIVATION_MIN_MINUTES, raw));
}
