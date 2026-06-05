import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateStreak } from "@/lib/streak";
import { getTodayStartISO } from "@/lib/accountability";

const VALID_TYPES = ["srs_review", "dsa_practice", "aiml_study", "feynman", "mixed"];

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const todayStart = getTodayStartISO();

  const { data, error } = await supabase
    .from("study_sessions")
    .select("id, started_at, ended_at, session_type, planned_minutes, actual_minutes")
    .eq("user_id", user.id)
    .gte("started_at", todayStart)
    .order("started_at", { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    sessions: data ?? [],
    hasSessionToday: (data?.length ?? 0) > 0,
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { session_type, planned_minutes } = body;

  if (!session_type || !VALID_TYPES.includes(session_type)) {
    return Response.json({ error: "Invalid session_type" }, { status: 400 });
  }

  const { data: session, error } = await supabase
    .from("study_sessions")
    .insert({
      user_id: user.id,
      session_type,
      planned_minutes: planned_minutes ?? null,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !session) {
    return Response.json({ error: error?.message ?? "Failed to start session" }, { status: 500 });
  }

  const streakResult = await updateStreak(supabase, user.id);

  return Response.json({
    session,
    streak: streakResult.data,
  });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { session_id, actual_minutes, cards_reviewed, problems_logged, mood_end, energy_level } =
    body;

  if (!session_id) {
    return Response.json({ error: "session_id required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    ended_at: new Date().toISOString(),
  };
  if (actual_minutes != null) updates.actual_minutes = actual_minutes;
  if (cards_reviewed != null) updates.cards_reviewed = cards_reviewed;
  if (problems_logged != null) updates.problems_logged = problems_logged;
  if (mood_end != null) updates.mood_end = mood_end;
  if (energy_level != null) updates.energy_level = energy_level;

  const { data, error } = await supabase
    .from("study_sessions")
    .update(updates)
    .eq("id", session_id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error || !data) {
    return Response.json({ error: error?.message ?? "Session not found" }, { status: 404 });
  }

  return Response.json({ session: data });
}
