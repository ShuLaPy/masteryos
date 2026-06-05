import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { streamText, generateText } from "@/lib/openai";

const MENTOR_SYSTEM = `You are the user's personal AI learning mentor for DSA and AIML mastery. You are strict, data-driven, and genuinely encouraging — like a great coach.

You have access to the user's real learning data provided in each message. Use it to give hyper-specific, actionable advice.

Rules:
- Be concise. Max 3-4 sentences for greeting, max 200 words for chat responses.
- Be specific — reference actual concept names, pattern names, actual numbers from their data.
- If they've been avoiding certain DSA patterns, call it out directly but encouragingly.
- If streak is high, celebrate it briefly.
- If due count is high, prioritize review urgently.
- If success rate is dropping or lapses are high, address retention strategy.
- If they have neglected certain patterns (like DP, greedy, graphs), suggest specific practice.
- Reference their daily completion percentage when relevant.
- Never be generic. No "keep up the great work" without specific data to back it.
- Format with line breaks for readability, no markdown headers.
- When discussing trends, reference the 7-day data provided.`;

/**
 * Build a detailed context string from the enriched mentor context
 */
function buildContextString(ctx: Record<string, unknown>): string {
  const daysSinceDSA = ctx.lastDSASolvedAt
    ? Math.floor((Date.now() - new Date(ctx.lastDSASolvedAt as string).getTime()) / 86400000)
    : null;

  const weakestConceptsStr = (ctx.weakestConcepts as { title: string; mastery: number }[] | undefined)?.length
    ? (ctx.weakestConcepts as { title: string; mastery: number }[])
        .map((c) => `${c.title} (${c.mastery}%)`)
        .join(", ")
    : "none logged yet";

  const patterns = ctx.dsaPatterns as Record<string, number> | undefined;
  const patternStr = patterns && Object.keys(patterns).length > 0
    ? Object.entries(patterns)
        .sort((a, b) => b[1] - a[1])
        .map(([p, count]) => `${p}: ${count}`)
        .join(", ")
    : "no problems logged this week";

  const stats = ctx.reviewStats as {
    totalCards: number;
    avgStability: number;
    totalLapses: number;
    totalReps: number;
    matureCardCount: number;
    successRate: number;
  } | undefined;

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

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { type, ctx, messages } = body;

  if (type === "greeting") {
    const contextStr = buildContextString(ctx);
    const userMsg = `Generate a concise greeting for this learner based on their current data. Be specific and actionable.\n\n${contextStr}`;

    const { data } = await generateText(MENTOR_SYSTEM, userMsg, 250);

    // Cache in daily_plans table
    if (data) {
      await supabase.from("daily_plans").upsert({
        user_id: user.id,
        plan_date: new Date().toISOString().split("T")[0],
        mentor_message: data,
        srs_due_count: ctx.dueCount,
      }, { onConflict: "user_id,plan_date" });
    }

    return Response.json({ message: data });
  }

  if (type === "chat") {
    const contextStr = buildContextString(ctx);
    const enrichedSystem = MENTOR_SYSTEM + "\n\n" + contextStr;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamText(enrichedSystem, messages, 512)) {
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
