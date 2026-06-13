import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { streamText, generateText } from "@/lib/openai";
import {
  computeLectureIntelligence,
  computeDsaRecommendation,
  type LectureIntel,
  type DsaRecommendation,
  type PrereqStatusKind,
} from "@/lib/mentor-context";

// The flagship mentor runs on the full gpt-5.4 model (the UI badge already
// promises "gpt-5.4"); other AI features stay on the cheaper default.
const MENTOR_MODEL = "gpt-5.4";

const MENTOR_SYSTEM = `You are the user's personal AI learning mentor for DSA and AIML mastery — the smartest, most context-aware coach on the platform. You are strict, data-driven, and genuinely encouraging, like an elite coach who plans the user's WEEK, not just their day.

You are given the user's REAL learning data in each message: SRS review stats, weakest concepts, DSA Glicko-2 ratings with neglected patterns and concrete ZPD-matched problem picks, AND an authoritative server-computed view of the lecture schedule with per-prerequisite readiness, effort estimates, and days remaining. Treat every data block as ground truth — it is computed fresh server-side.

## Core philosophy: DISTRIBUTE the load, don't cram (most important)
You are a planner, not a to-do dumper. When a lecture is several days away with weak/unstudied prerequisites, NEVER tell the user to do it all today. Spread the work across the days that remain:
- Spaced repetition only builds durable retention through MULTIPLE exposures across MULTIPLE days. Cramming two concepts into one day is wasted effort — the second won't stick.
- Size the work from the data: each prereq carries an estimatedMinutes effort and a current status/retention. The day has a budget (the user's daily goal minutes) shared across prereq study + SRS reviews + one DSA problem — only schedule what genuinely fits.
- Sequence concepts: start the highest-priority prereq today, REINFORCE it tomorrow, and only then advance to the next — gated on performance. State the checkpoint explicitly, e.g. "if its retention looks solid tomorrow, move to <next>; if not, give it one more day."
- Every day must still leave room for due SRS cards and one DSA problem.

## The default daily structure (keep this order)
1. Today's scheduled prereq concept (the one you paced for today) — study or refresh it.
2. Clear today's due SRS cards — this protects everything already learned.
3. Solve ONE DSA problem — choose from the suggested ZPD problems (challenging-but-winnable for the user's Glicko-2 rating), biased toward a neglected/weak pattern. Name the exact problem, its pattern, its difficulty, and one sentence of why.

## When the user asks "what should I focus on today"
Open with a one-line headline of today's single focus, THEN the structured day plan, THEN the multi-day pacing to the lecture. Importance order: imminent lecture prep (paced across days) > due SRS reviews > weak concepts > DSA cadence.

## DSA selection rules
- Calibrate your tone, explanation depth, and problem difficulty to the user's stated skill level (beginner / intermediate / advanced). If the level is CALIBRATING, prioritize diagnostic, near-peer problems to localize their level quickly, and say you're still getting a read on their level.
- Pick difficulty by the user's ZPD for the target pattern — never far above or below their Glicko-2 rating.
- Prefer neglected/under-practiced patterns; if the user is already balanced and strong, say so and suggest a maintenance problem.
- If concrete problems are provided, recommend one by name; otherwise prescribe a problem in the top neglected/weak pattern at its ZPD difficulty.

## Hard rules
- Be specific: real concept/lecture/pattern names, real numbers, days-until, estimated minutes, readiness/retention %, Glicko-2 ratings.
- Never call a prerequisite or concept fine if the data says it is UNSTUDIED or WEAK.
- If weekly retention looks high but prerequisites are untouched, clarify: weekly retention only reflects cards already reviewed, not untouched prerequisites.
- No empty praise — back every encouragement with a specific number.

## Output format (ALWAYS use this structured markdown)
- One bold headline sentence naming today's focus.
- A \`### Today\` section: a NUMBERED, time-boxed list following the daily structure (e.g. "1. **Backpropagation** (~15 min) — refresh the chain-rule cards", "2. **SRS reviews** — clear your N due cards", "3. **DSA: Two Sum** (Easy · Hashing) — ...").
- A \`### Plan to <lecture> (<N> days)\` section: a short day-by-day pacing of the remaining prerequisites with performance checkpoints. Include this whenever a lecture still has prep remaining.
- Optionally a one-line \`### Why\` for rationale.
- Use **bold** for names and key numbers, use lists generously, keep paragraphs to 1-2 sentences. Use ONLY \`###\` headings (never h1/h2).`;

// ─── Context string builders ──────────────────────────────────────────────────

/**
 * Build a detailed context string from the enriched mentor context (the stats
 * the client already collected: streak, SRS, DSA, weak concepts).
 */
function buildContextString(ctx: Record<string, unknown>): string {
  const daysSinceDSA = ctx.lastDSASolvedAt
    ? Math.floor(
      (Date.now() - new Date(ctx.lastDSASolvedAt as string).getTime()) /
      86400000
    )
    : null;

  const weakestConceptsStr = (
    ctx.weakestConcepts as { title: string; mastery: number }[] | undefined
  )?.length
    ? (ctx.weakestConcepts as { title: string; mastery: number }[])
      .map((c) => `${c.title} (${c.mastery}%)`)
      .join(", ")
    : "none logged yet";

  const stats = ctx.reviewStats as
    | {
      totalCards: number;
      avgStability: number;
      totalLapses: number;
      totalReps: number;
      matureCardCount: number;
      successRate: number;
    }
    | undefined;

  return `
User context:
- Name: ${ctx.displayName}
- Streak: ${ctx.streakCount} days
- Daily goal (total time budget today): ${ctx.goalMinutes} minutes/day
- Today's completion: ${ctx.completionPct ?? 0}%

SRS Review Stats:
- Cards due today: ${ctx.dueCount}
- Total cards in system: ${stats?.totalCards ?? 0}
- Mature cards (stability >10): ${stats?.matureCardCount ?? 0}
- Average stability: ${stats?.avgStability ?? 0} days
- Success rate: ${stats?.successRate ?? 0}% (${stats?.totalReps ?? 0} reps, ${stats?.totalLapses ?? 0} lapses)
- Cards reviewed this week: ${ctx.weeklyCardsReviewed ?? 0}

AIML Concepts — Weakest areas:
- ${weakestConceptsStr}

DSA recency:
- Days since last solve: ${daysSinceDSA !== null ? daysSinceDSA : "never"}
- Problems solved last 7 days: ${ctx.dsaProblemCount7d ?? 0}`.trim();
}

const STATUS_LABEL: Record<PrereqStatusKind, string> = {
  unstudied: "UNSTUDIED (cards exist but never reviewed = zero knowledge)",
  weak: "WEAK",
  strong: "STRONG",
};

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Render the authoritative lecture intelligence into the mentor's context, with
 * per-prereq effort estimates and days-remaining so the model can PACE the work.
 */
function buildLectureContextString(intel: LectureIntel): string {
  const lines: string[] = [
    "LECTURE SCHEDULE & PREREQUISITE READINESS (authoritative — computed fresh server-side from FSRS state). Use estimatedMinutes + days-to-prepare to PACE study across days, not cram:",
  ];

  if (intel.upcoming.length === 0) {
    lines.push("- No upcoming un-attended lectures are scheduled.");
  } else {
    lines.push("\nUpcoming lectures:");
    intel.upcoming.forEach((lec, i) => {
      const when =
        lec.daysUntil === 0
          ? "TODAY"
          : lec.daysUntil === 1
            ? "in 1 day"
            : `in ${lec.daysUntil} days`;
      lines.push(
        `${i + 1}. "${lec.title}" — ${when} (${lec.scheduledDate})${lec.imminent ? " [IMMINENT]" : ""}`
      );
      lines.push(
        `   Readiness: ${pct(lec.readinessScore)} · Coverage: ${lec.prereqCount === 0
          ? "no prerequisites"
          : `${Math.round(lec.coverage * lec.prereqCount)}/${lec.prereqCount} prereqs studied`
        } · Prep remaining: ~${lec.prepMinutesRemaining} min · Days to prepare: ${Math.max(lec.daysUntil, 0)}`
      );
      if (lec.prereqs.length > 0) {
        lines.push("   Prerequisites (highest priority first):");
        for (const p of lec.prereqs) {
          const retention =
            p.status === "unstudied" ? "" : ` (retention ${pct(p.retrievability)})`;
          lines.push(
            `     - ${p.title}: ${STATUS_LABEL[p.status]}${retention}, ~${p.estimatedMinutes} min effort, priority ${p.priority.toFixed(2)}`
          );
        }
      }
    });
  }

  if (intel.recentAttended) {
    const r = intel.recentAttended;
    const retention =
      r.avgRetrievability === null
        ? "not yet reviewed"
        : `avg retention ${pct(r.avgRetrievability)}`;
    lines.push(
      `\nMost recently attended lecture: "${r.title}" (${r.daysAgo} day${r.daysAgo === 1 ? "" : "s"} ago) — ${retention} across ${r.conceptCount} concept${r.conceptCount === 1 ? "" : "s"}.`
    );
  }

  if (intel.topPriorities.length > 0) {
    lines.push("\nHIGHEST-PRIORITY PREP ACTIONS (ranked by Bridge & Runway priority score — pace these across the days available, don't do all at once):");
    intel.topPriorities.forEach((a, i) => {
      const when =
        a.daysUntil === 0
          ? "today"
          : a.daysUntil === 1
            ? "in 1 day"
            : `in ${a.daysUntil} days`;
      lines.push(
        `${i + 1}. ${a.conceptTitle} — prereq for "${a.lectureTitle}" ${when} — ${a.status.toUpperCase()}`
      );
    });
  } else if (intel.upcoming.length > 0) {
    lines.push(
      "\nAll prerequisites for upcoming lectures are STRONG — no prep emergencies. Focus on reviews and DSA."
    );
  }

  return lines.join("\n");
}

/**
 * Render the authoritative DSA recommendation (Glicko-2 weakness + ZPD problem
 * picks + portfolio drift) so the mentor names a specific, well-calibrated problem.
 */
function buildDsaContextString(dsa: DsaRecommendation): string {
  const gs = dsa.globalSkill;
  const levelLine =
    gs.level === "calibrating"
      ? `- Skill level: CALIBRATING (not enough confident data yet — prefer diagnostic, near-peer problems to localize their level; global rating ${Math.round(gs.globalRating)})`
      : `- Skill level: ${gs.level.toUpperCase()} (global Glicko-2 rating ${Math.round(gs.globalRating)}, confidence ${pct(gs.confidence)}, ${gs.breadthAttempted}/25 patterns practiced)`;

  const lines: string[] = [
    "DSA PRACTICE (authoritative — Glicko-2 skill ratings, ZPD difficulty, portfolio drift):",
    levelLine,
    `- Practice balance: ${pct(dsa.balanceScore)} (100% = evenly spread across patterns)`,
    `- Neglected patterns (under-practiced): ${dsa.neglectedPatterns.length ? dsa.neglectedPatterns.join(", ") : "none"}`,
    `- Over-practiced patterns: ${dsa.overPracticedPatterns.length ? dsa.overPracticedPatterns.join(", ") : "none"}`,
  ];

  if (dsa.weakestPatterns.length > 0) {
    lines.push("- Weakest patterns (Glicko-2 rating, recommended ZPD difficulty):");
    for (const w of dsa.weakestPatterns) {
      lines.push(`    · ${w.pattern}: rating ${w.rating}, ZPD ${w.zpd}`);
    }
  }

  lines.push(
    `- Due re-solve ladder cards: ${dsa.dueReSolveCount} · Due recognition drills: ${dsa.dueRecognitionDrillCount}`
  );

  if (dsa.suggestedProblems.length > 0) {
    lines.push("- Suggested next problems (ZPD-matched, biased to neglected patterns) — recommend ONE by name:");
    dsa.suggestedProblems.forEach((p, i) => {
      lines.push(
        `    ${i + 1}. "${p.title}" (${p.difficulty}, pattern: ${p.pattern})${p.url ? ` — ${p.url}` : ""}`
      );
    });
  } else {
    lines.push(
      "- No specific problem in the bank matched — prescribe a problem in the top neglected/weak pattern at its ZPD difficulty."
    );
  }

  return lines.join("\n");
}

/**
 * Merge the latest skill-level label into users.settings.skill_level_cache so the
 * hysteresis in computeGlobalSkill has a previous label to resist flapping
 * against. Read-modify-write of the jsonb blob; failures are swallowed (best
 * effort — the level still computes correctly without the cache).
 */
async function persistSkillLevel(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  level: string
): Promise<void> {
  try {
    const { data } = await supabase
      .from("users")
      .select("settings")
      .eq("id", userId)
      .single();
    const settings = (data?.settings ?? {}) as Record<string, unknown>;
    if (settings.skill_level_cache === level) return; // no-op when unchanged
    await supabase
      .from("users")
      .update({ settings: { ...settings, skill_level_cache: level } })
      .eq("id", userId);
  } catch {
    /* best effort — ignore */
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { type, ctx, messages } = body;

  // Re-derive lecture intelligence + DSA recommendation server-side so the AI
  // always reasons over fresh, untampered data — never what the browser sent.
  const [lectureRes, dsaRes] = await Promise.all([
    computeLectureIntelligence(supabase, user.id),
    computeDsaRecommendation(supabase, user.id),
  ]);
  const lectureContext = lectureRes.data
    ? "\n\n" + buildLectureContextString(lectureRes.data)
    : "";
  const dsaContext = dsaRes.data
    ? "\n\n" + buildDsaContextString(dsaRes.data)
    : "";

  // Persist the (hysteretic) skill level so future computations resist flapping
  // near a band boundary across sessions. Fire-and-forget; never blocks the AI.
  if (dsaRes.data && dsaRes.data.globalSkill.level !== "calibrating") {
    void persistSkillLevel(supabase, user.id, dsaRes.data.globalSkill.level);
  }

  if (type === "greeting") {
    const contextStr = buildContextString(ctx) + lectureContext + dsaContext;
    const userMsg = `Generate a concise, structured greeting for this learner based on their current data. Lead with their single most important focus for today, and if an upcoming lecture has untouched prerequisites, frame it as a paced plan (not "do it all today"). Keep it to a bold headline plus at most 3 short bullet points.\n\n${contextStr}`;

    const { data } = await generateText(MENTOR_SYSTEM, userMsg, 450, MENTOR_MODEL);

    // Cache in daily_plans table
    if (data) {
      await supabase.from("daily_plans").upsert(
        {
          user_id: user.id,
          plan_date: new Date().toISOString().split("T")[0],
          mentor_message: data,
          srs_due_count: ctx.dueCount,
        },
        { onConflict: "user_id,plan_date" }
      );
    }

    return Response.json({ message: data });
  }

  if (type === "chat") {
    const contextStr = buildContextString(ctx) + lectureContext + dsaContext;
    const enrichedSystem = MENTOR_SYSTEM + "\n\n" + contextStr;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamText(
            enrichedSystem,
            messages,
            1100,
            MENTOR_MODEL
          )) {
            controller.enqueue(encoder.encode(chunk));
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return Response.json({ error: "Invalid type" }, { status: 400 });
}
