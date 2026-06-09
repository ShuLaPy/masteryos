import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { streamText, generateText } from "@/lib/openai";
import {
  computeLectureIntelligence,
  type LectureIntel,
  type PrereqStatusKind,
} from "@/lib/mentor-context";

// The flagship mentor runs on the full gpt-4o model (the UI badge already
// promises "GPT-4o"); other AI features stay on the cheaper default.
const MENTOR_MODEL = "gpt-4o";

const MENTOR_SYSTEM = `You are the user's personal AI learning mentor for DSA and AIML mastery — the smartest, most context-aware coach on the platform. You are strict, data-driven, and genuinely encouraging, like an elite coach who knows exactly where the user stands.

You are given the user's REAL learning data in each message: SRS review stats, weakest concepts, DSA pattern history, AND an authoritative, server-computed view of their lecture schedule with per-prerequisite readiness. Treat the lecture/readiness block as ground truth — it is computed fresh server-side and is never wrong.

## How to prioritize "what should I focus on today" (strict order)
Rank the day's work by leverage, not by what's easiest:
1. **Imminent lecture prep** — if an upcoming lecture is within ~7 days and any of its prerequisites are UNSTUDIED or WEAK, this is almost always #1. An unstudied prerequisite for a lecture in a few days is an emergency: the user will be lost in class. Call it out by name with the lecture and days remaining.
2. **Overdue SRS reviews** — if cards are due, clearing them protects everything already learned. High due counts are urgent.
3. **Weak concepts** — low-mastery AIML areas that aren't already covered above.
4. **DSA cadence** — if it's been >2 days since the last problem, or a pattern is neglected, prescribe a specific pattern to practice.
Always lead with the single most important action. Do not bury the lecture prep under generic review advice.

## Hard rules
- Be specific. Reference actual concept names, lecture titles, pattern names, real numbers, days-until, and readiness/retention percentages from the data. Never be generic.
- Never say a prerequisite or concept is fine if the data says it is UNSTUDIED or WEAK. If readiness is low, say so plainly and explain the consequence.
- If a readiness number looks high (e.g. weekly retention) but prerequisites are untouched, clarify the distinction: weekly retention only reflects cards already reviewed, not untouched prerequisites.
- No empty praise — every encouragement must be backed by a specific number (streak, success rate, problems solved).
- Keep it tight: a focused answer, not an essay.

## Output format (ALWAYS use this structured markdown)
- Open with one bold headline sentence naming the #1 focus (e.g. **Your #1 priority today: study Backpropagation before Sunday's lecture.**).
- Then a \`### Today's priorities\` section with a NUMBERED list, each item a bold lead-in followed by the specific action and the data that justifies it.
- Optionally add a short \`### Why this order\` or \`### Don't forget\` section only if it adds real value.
- Use **bold** for concept/lecture/pattern names and key numbers. Use bullet/numbered lists generously. Keep paragraphs to 1-2 sentences. Do NOT use h1/h2 — only \`###\` for section titles.`;

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

  const patterns = ctx.dsaPatterns as Record<string, number> | undefined;
  const patternStr =
    patterns && Object.keys(patterns).length > 0
      ? Object.entries(patterns)
          .sort((a, b) => b[1] - a[1])
          .map(([p, count]) => `${p}: ${count}`)
          .join(", ")
      : "no problems logged this week";

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
- Daily goal: ${ctx.goalMinutes} minutes/day
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

DSA (last 7 days):
- Problems solved: ${ctx.dsaProblemCount7d ?? 0}
- Days since last solve: ${daysSinceDSA !== null ? daysSinceDSA : "never"}
- Pattern distribution: ${patternStr}`.trim();
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
 * Render the authoritative lecture intelligence into the mentor's context. This
 * is what lets the mentor reason about upcoming lectures and untouched prereqs.
 */
function buildLectureContextString(intel: LectureIntel): string {
  const lines: string[] = [
    "LECTURE SCHEDULE & PREREQUISITE READINESS (authoritative — computed fresh server-side from FSRS state):",
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
        `   Readiness: ${pct(lec.readinessScore)} · Coverage: ${
          lec.prereqCount === 0
            ? "no prerequisites"
            : `${Math.round(lec.coverage * lec.prereqCount)}/${lec.prereqCount} prereqs studied`
        }`
      );
      if (lec.prereqs.length > 0) {
        lines.push("   Prerequisites (highest priority first):");
        for (const p of lec.prereqs) {
          const retention =
            p.status === "unstudied" ? "" : ` (retention ${pct(p.retrievability)})`;
          lines.push(
            `     - ${p.title}: ${STATUS_LABEL[p.status]}${retention}, priority ${p.priority.toFixed(2)}`
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
    lines.push("\nHIGHEST-PRIORITY PREP ACTIONS (ranked by Bridge & Runway priority score):");
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

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { type, ctx, messages } = body;

  // Re-derive lecture intelligence server-side so the AI always reasons over
  // fresh, untampered data — never what the browser happened to send.
  const { data: lectureIntel } = await computeLectureIntelligence(
    supabase,
    user.id
  );
  const lectureContext = lectureIntel
    ? "\n\n" + buildLectureContextString(lectureIntel)
    : "";

  if (type === "greeting") {
    const contextStr = buildContextString(ctx) + lectureContext;
    const userMsg = `Generate a concise, structured greeting for this learner based on their current data. Lead with their single most important focus for today (prioritize imminent lecture prep with untouched prerequisites). Keep it to a bold headline plus at most 3 short bullet points.\n\n${contextStr}`;

    const { data } = await generateText(MENTOR_SYSTEM, userMsg, 400, MENTOR_MODEL);

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
    const contextStr = buildContextString(ctx) + lectureContext;
    const enrichedSystem = MENTOR_SYSTEM + "\n\n" + contextStr;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamText(
            enrichedSystem,
            messages,
            800,
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
