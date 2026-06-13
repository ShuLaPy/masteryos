import { createClient } from "@/lib/supabase/server";
import { getWeekStartDate } from "@/lib/accountability";
import {
  selectQuestionPlan,
  buildExternalInterviewPrompt,
  toSlotMeta,
  type InterviewSlot,
} from "@/lib/interview-engine";

/**
 * GET /api/interview/external-prompt
 * Returns a self-contained meta-prompt the user can paste into an external LLM
 * (Perplexity, Claude, Gemini, etc.) to run the same mock interview outside the app.
 *
 * Reuses this week's cached question_plan when available; falls back to
 * generating one fresh (without persisting a session row).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // Try to reuse this week's cached plan.
  const { data: session } = await supabase
    .from("interview_sessions")
    .select("question_plan")
    .eq("user_id", user.id)
    .eq("week_start_date", getWeekStartDate())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let plan = (session?.question_plan as unknown as InterviewSlot[]) ?? [];

  if (plan.length === 0) {
    const { data, error } = await selectQuestionPlan(supabase, user.id);
    if (error) {
      return Response.json({ data: null, error }, { status: 500 });
    }
    plan = data ?? [];
  }

  if (plan.length === 0) {
    return Response.json({ data: { empty: true }, error: null });
  }

  const prompt = buildExternalInterviewPrompt(plan);
  return Response.json({ data: { prompt, slotsMeta: toSlotMeta(plan) }, error: null });
}
