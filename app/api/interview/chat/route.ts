import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { streamText } from "@/lib/openai";
import { buildPlanContext, type InterviewSlot } from "@/lib/interview-engine";
import type { Json } from "@/types/database";

/**
 * POST /api/interview/chat  { sessionId, messages }
 * Streaming interview turn. The plan + current_slot are read authoritatively from
 * the session (the client never sends them). The running transcript is persisted
 * after each turn so an interrupted session can resume with full history.
 *
 * Mirrors app/api/ai/feynman/route.ts POST, on gpt-4o.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { sessionId, messages } = body as {
    sessionId: string;
    messages: { role: "user" | "assistant"; content: string }[];
  };

  if (!sessionId || !Array.isArray(messages)) {
    return new Response("Bad request", { status: 400 });
  }

  const { data: session, error } = await supabase
    .from("interview_sessions")
    .select("question_plan, current_slot, status")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .single();

  if (error || !session) return new Response("Session not found", { status: 404 });

  const plan = (session.question_plan as unknown as InterviewSlot[]) ?? [];
  const systemPrompt = buildPlanContext(plan, session.current_slot ?? 0);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let fullText = "";
      try {
        for await (const chunk of streamText(systemPrompt, messages, 1024, "gpt-4o")) {
          fullText += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
      } finally {
        // Persist the running transcript (durability + resume). Best-effort.
        if (fullText) {
          const transcript = [...messages, { role: "assistant", content: fullText }];
          await supabase
            .from("interview_sessions")
            .update({ transcript: transcript as unknown as Json })
            .eq("id", sessionId)
            .eq("user_id", user.id);
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
