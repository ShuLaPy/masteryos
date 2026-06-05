import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { streamText, generateText } from "@/lib/openai";

const MENTOR_SYSTEM = `You are the user's personal AI learning mentor for DSA and AIML mastery. You are strict, data-driven, and genuinely encouraging — like a great coach.

You have access to the user's real learning data provided in each message. Use it to give hyper-specific, actionable advice.

Rules:
- Be concise. Max 3-4 sentences for greeting, max 150 words for chat responses.
- Be specific — reference actual concept names, actual numbers from their data.
- If they've been avoiding something, call it out directly but encouragingly.
- If streak is high, celebrate it briefly.
- If due count is high, prioritize review urgently.
- Never be generic. No "keep up the great work" without specific data to back it.
- Format with line breaks for readability, no markdown headers.`;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { type, ctx, messages } = body;

  if (type === "greeting") {
    const userMsg = `Generate a concise morning greeting for this learner.
Name: ${ctx.displayName}
Streak: ${ctx.streakCount} days
Due cards today: ${ctx.dueCount}
Weakest concept: ${ctx.weakestConcept ? `${ctx.weakestConcept.title} (${ctx.weakestConcept.mastery}% mastery)` : "none logged yet"}
Days since last DSA problem: ${ctx.lastDSASolvedAt ? Math.floor((Date.now() - new Date(ctx.lastDSASolvedAt).getTime()) / 86400000) : "never"}
Goal: ${ctx.goalMinutes} minutes/day`;

    const { data } = await generateText(MENTOR_SYSTEM, userMsg, 200);

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
    const contextMsg = `
User context:
- Name: ${ctx.displayName}
- Streak: ${ctx.streakCount} days
- Due cards: ${ctx.dueCount}
- Weakest AIML concept: ${ctx.weakestConcept ? `${ctx.weakestConcept.title} (${ctx.weakestConcept.mastery}% mastery)` : "none yet"}
- Days since last DSA: ${ctx.lastDSASolvedAt ? Math.floor((Date.now() - new Date(ctx.lastDSASolvedAt).getTime()) / 86400000) : "never solved"}`;

    // Prepend context to system, then stream
    const enrichedSystem = MENTOR_SYSTEM + "\n\n" + contextMsg;

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
