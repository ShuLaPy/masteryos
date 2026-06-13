import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateText } from "@/lib/openai";
import { getWeekStartDate } from "@/lib/accountability";
import { updateStreak } from "@/lib/streak";
import {
  selectQuestionPlan,
  buildPlanContext,
  toSlotMeta,
  type InterviewSlot,
} from "@/lib/interview-engine";
import type { Json } from "@/types/database";

/**
 * GET /api/interview
 * Returns this week's session (for resume / scorecard) plus a short history list.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const weekStartDate = getWeekStartDate();

  const [currentRes, historyRes] = await Promise.all([
    supabase
      .from("interview_sessions")
      .select("id, status, question_plan, grades, transcript, current_slot, overall_score")
      .eq("user_id", user.id)
      .eq("week_start_date", weekStartDate)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("interview_sessions")
      .select("id, status, overall_score, started_at, ended_at, week_start_date")
      .eq("user_id", user.id)
      .eq("status", "complete")
      .order("ended_at", { ascending: false })
      .limit(10),
  ]);

  const current = currentRes.data
    ? {
      sessionId: currentRes.data.id,
      status: currentRes.data.status,
      slotsMeta: toSlotMeta((currentRes.data.question_plan as unknown as InterviewSlot[]) ?? []),
      grades: currentRes.data.grades,
      transcript: currentRes.data.transcript,
      currentSlot: currentRes.data.current_slot,
      overallScore: currentRes.data.overall_score,
    }
    : null;

  return Response.json({
    data: { current, history: historyRes.data ?? [] },
    error: null,
  });
}

/**
 * POST /api/interview  { action: "start", length? }
 * Builds the question plan, creates the session, generates the opening question.
 * If a session already exists this week it is returned (resume) — one per week.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (body.action !== "start") {
    return Response.json({ data: null, error: "Invalid action" }, { status: 400 });
  }

  const weekStartDate = getWeekStartDate();

  // One interview per week — resume an existing one rather than duplicating.
  const { data: existing } = await supabase
    .from("interview_sessions")
    .select("id, status, question_plan, transcript, current_slot, overall_score")
    .eq("user_id", user.id)
    .eq("week_start_date", weekStartDate)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const plan = (existing.question_plan as unknown as InterviewSlot[]) ?? [];
    return Response.json({
      data: {
        sessionId: existing.id,
        status: existing.status,
        totalSlots: plan.length,
        slotsMeta: toSlotMeta(plan),
        transcript: existing.transcript,
        currentSlot: existing.current_slot,
        overallScore: existing.overall_score,
        resumed: true,
      },
      error: null,
    });
  }

  const { data: plan, error: planError } = await selectQuestionPlan(
    supabase,
    user.id,
    typeof body.length === "number" ? body.length : 5
  );
  if (planError) {
    return Response.json({ data: null, error: planError }, { status: 500 });
  }
  if (!plan || plan.length === 0) {
    return Response.json({ data: { empty: true }, error: null });
  }

  // Opening question for slot 0.
  const sys = buildPlanContext(plan, 0);
  const { data: generated } = await generateText(
    sys,
    "Begin the mock interview now. Greet the candidate in one sentence, then ask your first, fairly broad opening question for concept 0 — and be ready to drill down on their answer over the next turns. Do not emit any JSON yet.",
    400,
    "gpt-5.3-chat-latest"
  );
  const firstQuestion =
    generated?.trim() ||
    `Let's begin. To warm up: can you explain "${plan[0].title}" in your own words — and walk me through why it works?`;

  const { data: session, error: insertError } = await supabase
    .from("interview_sessions")
    .insert({
      user_id: user.id,
      status: "active",
      question_plan: plan as unknown as Json,
      grades: [] as unknown as Json,
      transcript: [{ role: "assistant", content: firstQuestion }] as unknown as Json,
      current_slot: 0,
      week_start_date: weekStartDate,
    })
    .select("id")
    .single();

  if (insertError || !session) {
    return Response.json(
      { data: null, error: insertError?.message ?? "Failed to create session" },
      { status: 500 }
    );
  }

  return Response.json({
    data: {
      sessionId: session.id,
      status: "active",
      totalSlots: plan.length,
      slotsMeta: toSlotMeta(plan),
      firstQuestion,
      currentSlot: 0,
      resumed: false,
    },
    error: null,
  });
}

/**
 * PATCH /api/interview  { action: "finish", sessionId, overall_score, transcript }
 * Closes the session, persists the final transcript + readiness score, logs a
 * study session, and updates the streak.
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (body.action !== "finish" || !body.sessionId) {
    return Response.json({ data: null, error: "Invalid request" }, { status: 400 });
  }

  const overallScore =
    typeof body.overall_score === "number"
      ? Math.max(0, Math.min(1, body.overall_score))
      : null;

  const updates: Record<string, unknown> = {
    status: "complete",
    ended_at: new Date().toISOString(),
    overall_score: overallScore,
  };
  if (Array.isArray(body.transcript)) {
    updates.transcript = body.transcript as unknown as Json;
  }

  const { data: session, error } = await supabase
    .from("interview_sessions")
    .update(updates)
    .eq("id", body.sessionId)
    .eq("user_id", user.id)
    .select("id, started_at")
    .single();

  if (error || !session) {
    return Response.json(
      { data: null, error: error?.message ?? "Session not found" },
      { status: 404 }
    );
  }

  // Log the work as a study session (reuses the existing study_sessions shape).
  const startedMs = new Date(session.started_at).getTime();
  const actualMinutes = Math.max(1, Math.round((Date.now() - startedMs) / 60000));
  const nowIso = new Date().toISOString();
  await supabase.from("study_sessions").insert({
    user_id: user.id,
    session_type: "mixed",
    started_at: session.started_at,
    ended_at: nowIso,
    actual_minutes: actualMinutes,
  });

  await updateStreak(supabase, user.id);

  return Response.json({ data: { ok: true }, error: null });
}
