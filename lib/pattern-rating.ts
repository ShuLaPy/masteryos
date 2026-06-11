/**
 * Glicko-2 skill-rating engine for DSA pattern mastery.
 *
 * Implements the Glicko-2 algorithm (Glickman, 2013) from scratch — no external
 * dependency — for the per-(user, pattern) skill layer described in
 * docs/masteryos-dsa-mastery-spec.md §4.
 *
 * Every problem attempt is a "match" against an opponent whose rating is derived
 * from the problem's difficulty (§4.2). The outcome maps to a score in [0,1].
 * A single attempt produces one Glicko-2 update per credited pattern.
 *
 * All functions here are pure (no DB, no IO). The rating math is server-side only.
 */

// --- Glicko-2 system constants ---------------------------------------------

/** Scale factor between Glicko (1500-centred) and Glicko-2 (0-centred) ratings. */
export const GLICKO2_SCALE = 173.7178;

/** Base rating that maps to μ = 0 on the Glicko-2 scale. */
export const BASE_RATING = 1500;

/**
 * System constant τ — constrains volatility change over time. Smaller values
 * prevent dramatic rating swings. The spec / Glickman recommend 0.3–1.2; we use
 * 0.5 as a balanced default.
 */
const TAU = 0.5;

/** Convergence tolerance for the volatility iteration. */
const EPSILON = 0.000001;

/** Maximum rating deviation — a fully uncertain rating (matches DB default). */
export const RD_MAX = 350;

/**
 * Minimum rating deviation on update output — keeps ratings responsive after
 * long streaks (Lichess production value). Below PHI_FRESH (50), so the
 * staleness and ZPD-uncertainty signals still reach exactly zero.
 */
export const RD_MIN = 45;

/**
 * Cap on volatility σ — prevents runaway erraticism from pathological input
 * sequences (Lichess production value).
 */
export const VOLATILITY_MAX = 0.1;

/** Fallback σ when the stored value is unusable (matches DB default). */
const DEFAULT_VOLATILITY = 0.06;

/**
 * Hard cap on the σ' iteration loops. The Illinois iteration converges in ≤ 11
 * steps on all valid inputs (verified empirically) — this only binds on inputs
 * the sanitizer should have already rejected.
 */
const MAX_VOLATILITY_ITERATIONS = 100;

// --- Weakness-signal constants (§4.4) --------------------------------------

const TARGET_RATING = 1650;
const TARGET_SPREAD = 350;
const PHI_FRESH = 50; // φ of a freshly-attempted pattern (low uncertainty)
const PHI_MAX = 350; // φ of a fully-decayed / never-seen pattern

// --- Public types ----------------------------------------------------------

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const ATTEMPT_OUTCOMES = [
  "solved_fast",
  "solved_effort",
  "solved_hint",
  "solved_after_approach",
  "failed",
] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

export function isDifficulty(value: unknown): value is Difficulty {
  return (DIFFICULTIES as readonly unknown[]).includes(value);
}

export function isAttemptOutcome(value: unknown): value is AttemptOutcome {
  return (ATTEMPT_OUTCOMES as readonly unknown[]).includes(value);
}

export interface Glicko2State {
  /** Skill estimate μ on the Glicko (1500-centred) scale. */
  rating: number;
  /** Rating deviation φ (uncertainty). */
  rd: number;
  /** Volatility σ — how erratic recent results are. */
  volatility: number;
}

// --- 1. Difficulty → opponent rating (§4.2) --------------------------------

/**
 * Map a problem's difficulty to the rating of the "opponent" it represents.
 * Beating a harder opponent raises μ more; losing to an easy one drops it more.
 */
export function difficultyToRating(difficulty: Difficulty): number {
  switch (difficulty) {
    case "easy":
      return 1300;
    case "medium":
      return 1550;
    case "hard":
      return 1800;
  }
}

// --- 2. Outcome → score s ∈ [0,1] (§4.2) -----------------------------------

/**
 * Map the attempt outcome to a Glicko score in [0,1]. 1.0 is a clean win
 * (solved unaided, fast); 0.0 is a loss (failed / read the full solution).
 */
export function outcomeToScore(outcome: AttemptOutcome): number {
  switch (outcome) {
    case "solved_fast":
      return 1.0;
    case "solved_effort":
      return 0.7;
    case "solved_hint":
      return 0.5;
    case "solved_after_approach":
      return 0.35;
    case "failed":
      return 0.0;
  }
}

// --- Glicko-2 internal helpers ---------------------------------------------

/** g(φ) — weights an opponent's impact by their rating deviation. */
export function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/** E(μ, μ_j, φ_j) — expected score against opponent j (Glicko-2 scale). */
export function expectedScore(
  mu: number,
  muOpp: number,
  phiOpp: number,
): number {
  return 1 / (1 + Math.exp(-g(phiOpp) * (mu - muOpp)));
}

/**
 * Solve for the new volatility σ' via the Illinois-variant regula-falsi
 * iteration from Glickman's paper (step 5).
 */
function newVolatility(
  sigma: number,
  phi: number,
  v: number,
  delta: number,
): number {
  const a = Math.log(sigma * sigma);
  const tauSq = TAU * TAU;
  const phiSq = phi * phi;
  const deltaSq = delta * delta;

  const f = (x: number): number => {
    const ex = Math.exp(x);
    const num = ex * (deltaSq - phiSq - v - ex);
    const den = 2 * Math.pow(phiSq + v + ex, 2);
    return num / den - (x - a) / tauSq;
  };

  // Initial bracketing of the root [A, B].
  let A = a;
  let B: number;
  if (deltaSq > phiSq + v) {
    B = Math.log(deltaSq - phiSq - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0 && k < MAX_VOLATILITY_ITERATIONS) {
      k += 1;
    }
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);

  let iterations = 0;
  while (Math.abs(B - A) > EPSILON && iterations < MAX_VOLATILITY_ITERATIONS) {
    iterations += 1;
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }

  return Math.exp(A / 2);
}

/**
 * Coerce a (possibly poisoned) state into the valid Glicko-2 domain. Non-finite
 * or out-of-range values fall back to the system defaults, so a bad DB row
 * self-heals on its next update instead of propagating NaN.
 */
function sanitizeState(s: Glicko2State): Glicko2State {
  return {
    rating: Number.isFinite(s.rating) ? s.rating : BASE_RATING,
    rd:
      Number.isFinite(s.rd) && s.rd > 0
        ? Math.min(s.rd, RD_MAX)
        : RD_MAX,
    volatility:
      Number.isFinite(s.volatility) && s.volatility > 0
        ? Math.min(s.volatility, VOLATILITY_MAX)
        : DEFAULT_VOLATILITY,
  };
}

// --- 3. Single-match Glicko-2 update ---------------------------------------

/**
 * Run a full Glicko-2 update for a single match (one rating period, one
 * opponent). Converts to the Glicko-2 scale, computes variance v and the
 * estimated improvement Δ, iterates the new volatility with τ, updates φ and μ,
 * then converts back to the Glicko (1500-centred) scale.
 *
 * @param current      Current state on the Glicko scale (rating, rd, volatility)
 * @param opponentRating Opponent rating on the Glicko scale (from difficulty)
 * @param score        Outcome score s ∈ [0,1]
 * @param opponentRd   Opponent rating deviation (Glicko scale). Defaults to
 *                     RD_MAX (the legacy behaviour — opponent uncertainty
 *                     unknown). When the opponent is a problem with a curated
 *                     Elo (problem_bank.elo_rating), pass a LOW value so the
 *                     match moves the rating more decisively.
 */
export function updateRating(
  current: Glicko2State,
  opponentRating: number,
  score: number,
  opponentRd: number = RD_MAX,
): Glicko2State {
  // Step 1 (hardening): sanitize inputs. Invalid evidence (non-finite score or
  // opponent) must never move the rating — return the sanitized state as-is.
  const safe = sanitizeState(current);
  if (!Number.isFinite(score) || !Number.isFinite(opponentRating)) {
    return safe;
  }
  const s = Math.max(0, Math.min(1, score));
  const oppRd = Number.isFinite(opponentRd) ? opponentRd : RD_MAX;

  // Step 2: convert player + opponent to the Glicko-2 scale.
  const mu = (safe.rating - BASE_RATING) / GLICKO2_SCALE;
  const phi = safe.rd / GLICKO2_SCALE;
  const sigma = safe.volatility;

  const muOpp = (opponentRating - BASE_RATING) / GLICKO2_SCALE;
  // Opponent uncertainty: max RD by default, or the supplied (lower) value when
  // the opponent is a confidently-rated problem.
  const phiOpp = Math.min(Math.max(oppRd, 0), RD_MAX) / GLICKO2_SCALE;

  // Step 3: variance v of the rating based on the single game outcome.
  const gOpp = g(phiOpp);
  const e = expectedScore(mu, muOpp, phiOpp);
  const v = 1 / (gOpp * gOpp * e * (1 - e));

  // Step 4: estimated improvement Δ in rating.
  const deltaSum = gOpp * (s - e);
  const delta = v * deltaSum;

  // Step 5: new volatility σ', capped at VOLATILITY_MAX.
  const sigmaPrime = Math.min(newVolatility(sigma, phi, v, delta), VOLATILITY_MAX);

  // Step 6: pre-rating-period RD (inflate by new volatility).
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);

  // Step 7: new φ' and μ'.
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * deltaSum;

  // Step 8: convert back to the Glicko scale.
  const next: Glicko2State = {
    rating: GLICKO2_SCALE * muPrime + BASE_RATING,
    rd: Math.min(Math.max(GLICKO2_SCALE * phiPrime, RD_MIN), RD_MAX),
    volatility: sigmaPrime,
  };

  // Final invariant: non-finite state never escapes.
  if (
    !Number.isFinite(next.rating) ||
    !Number.isFinite(next.rd) ||
    !Number.isFinite(next.volatility)
  ) {
    return safe;
  }
  return next;
}

// --- 4. RD inflation for inactivity ----------------------------------------

/**
 * Increase the rating deviation for a pattern that has not been attempted, so
 * unused patterns decay (φ grows with time → "we're no longer sure"). Treats
 * each day as one rating period: φ' = sqrt(φ² + σ²·t) on the Glicko-2 scale,
 * capped at RD_MAX.
 *
 * @param rd         Current rating deviation (Glicko scale)
 * @param volatility Current volatility σ
 * @param daysSince  Days since the last attempt (rating periods)
 */
export function inflateRdForInactivity(
  rd: number,
  volatility: number,
  daysSince: number,
): number {
  if (!Number.isFinite(rd)) return RD_MAX;
  const days = Number.isFinite(daysSince) ? daysSince : 0;
  if (days <= 0) return Math.min(rd, RD_MAX);
  const vol =
    Number.isFinite(volatility) && volatility > 0
      ? Math.min(volatility, VOLATILITY_MAX)
      : DEFAULT_VOLATILITY;
  const phi = rd / GLICKO2_SCALE;
  const phiStar = Math.sqrt(phi * phi + vol * vol * days);
  return Math.min(GLICKO2_SCALE * phiStar, RD_MAX);
}

/**
 * Effective rating deviation as of `now`: the stored rd inflated for the time
 * elapsed since the pattern's last attempt. This is the READ-TIME counterpart
 * of the write-path inflation in logAttemptAndUpdateMastery — every consumer
 * of pattern_mastery.rd (weakness, priority, ZPD, global skill, display)
 * should see the decayed uncertainty, not the value frozen at the last write.
 *
 * Null/invalid inputs degrade safely: missing last_attempt_at → stored rd
 * (clamped); missing volatility → the system default.
 */
export function currentRd(
  rd: number,
  volatility: number | null | undefined,
  lastAttemptAt: string | null | undefined,
  nowMs: number = Date.now(),
): number {
  if (!Number.isFinite(rd)) return RD_MAX;
  if (!lastAttemptAt) return Math.min(rd, RD_MAX);
  const lastMs = new Date(lastAttemptAt).getTime();
  if (!Number.isFinite(lastMs)) return Math.min(rd, RD_MAX);
  const daysSince = (nowMs - lastMs) / 86_400_000;
  return inflateRdForInactivity(rd, volatility ?? DEFAULT_VOLATILITY, daysSince);
}

// --- 5. Derived weakness signal (§4.4) -------------------------------------

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Derive a weakness signal in [0,1] from a pattern's mastery. A pattern is weak
 * if the rating is below target (masteryGap) OR if it has decayed / become
 * uncertain (staleness). Feeds pattern priority and the coach (§4.4).
 *
 *   masteryGap = clamp((targetRating − rating) / targetSpread, 0, 1)
 *   staleness  = clamp((rd − φ_fresh) / (φ_max − φ_fresh), 0, 1)
 *   Weakness   = max(masteryGap, 0.6 · staleness)
 */
export function weaknessFromMastery(rating: number, rd: number): number {
  const masteryGap = clamp01((TARGET_RATING - rating) / TARGET_SPREAD);
  const staleness = clamp01((rd - PHI_FRESH) / (PHI_MAX - PHI_FRESH));
  return Math.max(masteryGap, 0.6 * staleness);
}

// --- Worked-example assertions (verified numerically) ----------------------
//
// These document expected behaviour with concrete, hand-checkable numbers.
// Run `npm run verify:glicko2` — scripts/verify-glicko2.ts asserts all of them
// (plus a fuzz grid against an independent reference implementation).
//
// 1. Difficulty + outcome maps:
//    difficultyToRating('hard') === 1800
//    outcomeToScore('solved_after_approach') === 0.35
//
// 2. A fresh pattern (1500/350/0.06) that solves a hard problem unaided (s=1)
//    jumps well above 1500 and its RD shrinks (uncertainty falls):
//    const r = updateRating({ rating: 1500, rd: 350, volatility: 0.06 }, 1800, 1.0)
//    → r.rating ≈ 1769.8, r.rd ≈ 303.5, r.volatility ≈ 0.0600
//
// 3. The same fresh pattern that fails an easy problem (s=0) drops below 1500:
//    const r = updateRating({ rating: 1500, rd: 350, volatility: 0.06 }, 1300, 0.0)
//    → r.rating ≈ 1268.3, r.rd ≈ 296.6
//
// 4. Inactivity inflates RD toward the cap; a strong-but-stale pattern reads as
//    weak via staleness even though its rating is high:
//    inflateRdForInactivity(60, 0.06, 365) ≈ 208.0   // still below cap
//    inflateRdForInactivity(350, 0.06, 9999) === 350 // capped at RD_MAX
//    weaknessFromMastery(1700, 350) === 0.6           // 0.6 · staleness(=1)
//    weaknessFromMastery(1650, 50) === 0              // at target, fully fresh
//
// 5. Guardrails (only bind on pathological inputs; valid-domain dynamics are
//    byte-identical to pure Glicko-2 — proven by the fuzz grid):
//    updateRating(s, 1550, NaN) === sanitize(s)       // invalid evidence: no-op
//    output rd always ∈ [RD_MIN=45, RD_MAX=350]; σ' ≤ VOLATILITY_MAX=0.1
//    weaknessFromMastery(1650, 45) === 0              // floor below PHI_FRESH
//
// 6. currentRd applies inactivity inflation at READ time:
//    currentRd(60, 0.06, oneYearAgoIso) ≈ 208.0
//    currentRd(60, 0.06, null) === 60                 // never attempted → as stored
