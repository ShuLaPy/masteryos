/**
 * Glicko-2 verification suite for lib/pattern-rating.ts.
 *
 * Validates the production rating engine against an independent reference
 * implementation transcribed directly from Glickman's paper
 * (glicko.net/glicko/glicko2.pdf), then asserts the production guardrails
 * (volatility cap, rd floor/cap, NaN rejection, score clamping) and the
 * read-time inactivity-inflation helper.
 *
 * Pure computation — no DB, no env. Run: npm run verify:glicko2
 * Exits 1 if any assertion fails.
 */

import {
  updateRating,
  inflateRdForInactivity,
  currentRd,
  weaknessFromMastery,
  difficultyToRating,
  outcomeToScore,
  ATTEMPT_OUTCOMES,
  RD_MAX,
  RD_MIN,
  VOLATILITY_MAX,
  type Glicko2State,
} from "../lib/pattern-rating";
import { zpdTarget } from "../lib/zpd";

// ─── assertion harness ───────────────────────────────────────────────────────

let checks = 0;
const failures: string[] = [];

function assert(cond: boolean, msg: string): void {
  checks += 1;
  if (!cond) failures.push(msg);
}

function approx(actual: number, expected: number, tol: number): boolean {
  return Math.abs(actual - expected) <= tol;
}

// ============================================================================
// Reference implementation — multi-opponent rating period, per the paper.
// `guardrails: true` mirrors the two production policy clamps (σ' cap before
// step 6, rd clamp after step 8) so the fuzz grid can assert EXACT parity;
// the paper validation runs with guardrails off (pure Glicko-2).
// ============================================================================

const SCALE = 173.7178;
const BASE = 1500;
const TAU = 0.5; // must match lib/pattern-rating.ts
const EPS = 0.000001;

interface RefOpponent {
  rating: number;
  rd: number;
  score: number;
}

function refG(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function refE(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-refG(phiJ) * (mu - muJ)));
}

function refUpdate(
  player: Glicko2State,
  opponents: RefOpponent[],
  guardrails = false,
): Glicko2State {
  const mu = (player.rating - BASE) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.volatility;

  const ms = opponents.map((o) => ({
    muJ: (o.rating - BASE) / SCALE,
    phiJ: o.rd / SCALE,
    sJ: o.score,
  }));

  let vInv = 0;
  let sum = 0;
  for (const m of ms) {
    const gj = refG(m.phiJ);
    const e = refE(mu, m.muJ, m.phiJ);
    vInv += gj * gj * e * (1 - e);
    sum += gj * (m.sJ - e);
  }
  const v = 1 / vInv;
  const delta = v * sum;

  const a = Math.log(sigma * sigma);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const d = phi * phi + v + ex;
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * d * d) - (x - a) / (TAU * TAU);
  };

  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k += 1;
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);
  let iters = 0;
  while (Math.abs(B - A) > EPS) {
    iters += 1;
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB < 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
    if (iters > 10_000) throw new Error("reference σ' iteration failed to converge");
  }
  let sigmaPrime = Math.exp(A / 2);
  if (guardrails) sigmaPrime = Math.min(sigmaPrime, VOLATILITY_MAX);

  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * sum;

  let rd = SCALE * phiPrime;
  if (guardrails) rd = Math.min(Math.max(rd, RD_MIN), RD_MAX);

  return { rating: SCALE * muPrime + BASE, rd, volatility: sigmaPrime };
}

// ============================================================================
// 1. Pure reference vs the paper's official worked example
// ============================================================================

console.log("1. Paper worked example (pure reference)");
const paper = refUpdate({ rating: 1500, rd: 200, volatility: 0.06 }, [
  { rating: 1400, rd: 30, score: 1 },
  { rating: 1550, rd: 100, score: 0 },
  { rating: 1700, rd: 300, score: 0 },
]);
assert(approx(paper.rating, 1464.06, 0.01), `paper r'=${paper.rating} ≠ 1464.06`);
assert(approx(paper.rd, 151.52, 0.01), `paper RD'=${paper.rd} ≠ 151.52`);
assert(approx(paper.volatility, 0.05999, 0.00001), `paper σ'=${paper.volatility} ≠ 0.05999`);

// ============================================================================
// 2. Fuzz grid — project updateRating vs guardrailed reference (exact parity)
// ============================================================================

console.log("2. Fuzz grid (valid domain, exact parity vs reference)");
const ratings = [800, 1100, 1400, 1700, 2000, 2400];
const rds = [RD_MIN, 110, 190, 270, RD_MAX];
const vols = [0.03, 0.06, 0.09, VOLATILITY_MAX];
const oppRatings = [1000, 1400, 1800, 2200];
const oppRds = [30, 60, 190, RD_MAX];
const scores = [0, 0.35, 0.5, 0.7, 1.0];

let n = 0;
let maxDev = 0;
for (const r of ratings)
  for (const rd of rds)
    for (const vol of vols)
      for (const or_ of oppRatings)
        for (const ord of oppRds)
          for (const s of scores) {
            n += 1;
            const proj = updateRating({ rating: r, rd, volatility: vol }, or_, s, ord);
            const ref = refUpdate(
              { rating: r, rd, volatility: vol },
              [{ rating: or_, rd: ord, score: s }],
              true,
            );
            const dev = Math.max(
              Math.abs(proj.rating - ref.rating),
              Math.abs(proj.rd - ref.rd),
              Math.abs(proj.volatility - ref.volatility),
            );
            maxDev = Math.max(maxDev, dev);
            if (dev > 1e-9) {
              assert(
                false,
                `divergence ${dev.toExponential(3)} at player(${r}/${rd}/${vol}) opp(${or_}/${ord}) s=${s}`,
              );
            }
            assert(
              Number.isFinite(proj.rating) &&
                proj.rd >= RD_MIN &&
                proj.rd <= RD_MAX &&
                proj.volatility > 0 &&
                proj.volatility <= VOLATILITY_MAX,
              `invariant violated at player(${r}/${rd}/${vol}) opp(${or_}/${ord}) s=${s}`,
            );
          }
console.log(`   ${n} cases, max deviation ${maxDev.toExponential(3)}`);

// ============================================================================
// 3. Worked examples from the lib/pattern-rating.ts comment block
// ============================================================================

console.log("3. Worked examples (comment block)");
assert(difficultyToRating("hard") === 1800, "difficultyToRating('hard') ≠ 1800");
assert(outcomeToScore("solved_after_approach") === 0.35, "outcomeToScore('solved_after_approach') ≠ 0.35");

const ex2 = updateRating({ rating: 1500, rd: 350, volatility: 0.06 }, 1800, 1.0);
assert(approx(ex2.rating, 1769.8, 0.05), `ex2 rating=${ex2.rating} ≉ 1769.8`);
assert(approx(ex2.rd, 303.5, 0.05), `ex2 rd=${ex2.rd} ≉ 303.5`);
assert(approx(ex2.volatility, 0.06, 0.0005), `ex2 σ=${ex2.volatility} ≉ 0.06`);

const ex3 = updateRating({ rating: 1500, rd: 350, volatility: 0.06 }, 1300, 0.0);
assert(approx(ex3.rating, 1268.3, 0.05), `ex3 rating=${ex3.rating} ≉ 1268.3`);
assert(approx(ex3.rd, 296.6, 0.05), `ex3 rd=${ex3.rd} ≉ 296.6`);

assert(approx(inflateRdForInactivity(60, 0.06, 365), 208.0, 0.05), "inflate(60,0.06,365) ≉ 208.0");
assert(inflateRdForInactivity(350, 0.06, 9999) === 350, "inflate(350,0.06,9999) ≠ 350");
assert(inflateRdForInactivity(100, 0.06, -5) === 100, "inflate negative days should be identity");
assert(weaknessFromMastery(1700, 350) === 0.6, "weakness(1700,350) ≠ 0.6");
assert(weaknessFromMastery(1650, 50) === 0, "weakness(1650,50) ≠ 0");

// ============================================================================
// 4. Guardrails — invalid evidence never moves the rating; outputs bounded
// ============================================================================

console.log("4. Guardrails");
const fresh: Glicko2State = { rating: 1500, rd: 350, volatility: 0.06 };

// Non-finite score / opponent → no-op (state returned unchanged).
const nanScore = updateRating(fresh, 1550, NaN);
assert(
  nanScore.rating === 1500 && nanScore.rd === 350 && nanScore.volatility === 0.06,
  "NaN score must be a no-op",
);
const nanOpp = updateRating(fresh, NaN, 1);
assert(nanOpp.rating === 1500 && nanOpp.rd === 350, "NaN opponent must be a no-op");

// Out-of-range scores clamp to [0,1] (score=100 previously → rating 105,558).
const s100 = updateRating(fresh, 1550, 100);
const s1 = updateRating(fresh, 1550, 1);
assert(s100.rating === s1.rating && s100.rd === s1.rd, "score=100 must equal score=1");
const sNeg = updateRating(fresh, 1550, -0.5);
const s0 = updateRating(fresh, 1550, 0);
assert(sNeg.rating === s0.rating, "score=-0.5 must equal score=0");

// Poisoned current state self-heals to finite output.
const healed = updateRating({ rating: NaN, rd: 0, volatility: NaN }, 1550, 0.7);
assert(
  Number.isFinite(healed.rating) && Number.isFinite(healed.rd) && Number.isFinite(healed.volatility),
  "poisoned state must self-heal to finite output",
);

// Adversarial alternating extremes: volatility capped, rating bounded.
let sAdv = { ...fresh };
for (let i = 0; i < 200; i++) {
  sAdv = updateRating(sAdv, sAdv.rating, i % 2 === 0 ? 5 : -5, 60);
}
assert(sAdv.volatility <= VOLATILITY_MAX, `adversarial σ=${sAdv.volatility} > cap`);
assert(Math.abs(sAdv.rating - 1500) < 1000, `adversarial rating drifted to ${sAdv.rating}`);

// Sequential maximal upsets: still capped and bounded.
let sUpset = { ...fresh };
for (let i = 0; i < 200; i++) {
  const [opp, score] = sUpset.rating >= 1550 ? [1300, 0] : [1800, 1];
  sUpset = updateRating(sUpset, opp, score, 60);
  assert(sUpset.volatility <= VOLATILITY_MAX, "upset loop breached σ cap");
  assert(sUpset.rd >= RD_MIN && sUpset.rd <= RD_MAX, "upset loop breached rd bounds");
}

// Same-day grind: rd floored, never below RD_MIN.
let sGrind = { ...fresh };
for (let i = 0; i < 500; i++) {
  const inflated = inflateRdForInactivity(sGrind.rd, sGrind.volatility, 30 / 86400);
  sGrind = updateRating({ ...sGrind, rd: inflated }, sGrind.rating, i % 2 === 0 ? 0.7 : 0.5, 60);
  assert(sGrind.rd >= RD_MIN, `grind rd=${sGrind.rd} fell below floor`);
}

// outcomeToScore is total over the outcome enum.
for (const o of ATTEMPT_OUTCOMES) {
  const sc = outcomeToScore(o);
  assert(Number.isFinite(sc) && sc >= 0 && sc <= 1, `outcomeToScore(${o}) out of range`);
}

// ============================================================================
// 5. currentRd — read-time inactivity inflation
// ============================================================================

console.log("5. currentRd");
const DAY = 86_400_000;
const t0 = Date.parse("2026-01-01T00:00:00Z");
assert(currentRd(60, 0.06, null, t0) === 60, "currentRd null lastAttempt must return stored rd");
assert(
  approx(currentRd(60, 0.06, new Date(t0 - 365 * DAY).toISOString(), t0), 207.975, 0.05),
  "currentRd 365d ≉ 208",
);
assert(
  currentRd(60, 0.06, new Date(t0 - 100_000 * DAY).toISOString(), t0) === RD_MAX,
  "currentRd must cap at RD_MAX",
);
assert(currentRd(NaN, 0.06, null, t0) === RD_MAX, "currentRd NaN rd must degrade to RD_MAX");
assert(
  Number.isFinite(currentRd(60, null, new Date(t0 - 30 * DAY).toISOString(), t0)),
  "currentRd null volatility must stay finite",
);
assert(
  currentRd(60, 0.06, "not-a-date", t0) === 60,
  "currentRd invalid date must return stored rd",
);
// Future last_attempt_at (clock skew) must not deflate rd.
assert(
  currentRd(60, 0.06, new Date(t0 + 5 * DAY).toISOString(), t0) === 60,
  "currentRd future timestamp must be identity",
);

// ============================================================================
// 6. RD_MIN compatibility with downstream thresholds
// ============================================================================

console.log("6. RD_MIN threshold compatibility");
assert(weaknessFromMastery(1650, RD_MIN) === 0, "weakness at rd=RD_MIN must reach 0");
// ZPD uncertainty u = clamp((rd − 50)/300) → 0 at rd=45: full growth target.
const zpdAtFloor = zpdTarget({ rating: 1500, rd: RD_MIN });
assert(zpdAtFloor.targetSuccess === 0.85, `zpd targetSuccess at rd=45 = ${zpdAtFloor.targetSuccess} ≠ 0.85`);

// ─── summary ─────────────────────────────────────────────────────────────────

console.log(`\n${checks} checks, ${failures.length} failures`);
if (failures.length > 0) {
  for (const f of failures.slice(0, 25)) console.error(`  FAIL: ${f}`);
  if (failures.length > 25) console.error(`  …and ${failures.length - 25} more`);
  process.exit(1);
}
console.log("ALL PASS");
