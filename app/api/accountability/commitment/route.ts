import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWeekStartISO, parseSettings } from "@/lib/accountability";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const weekStart = getWeekStartISO();

  const [profileRes, reviewsRes, sessionsRes] = await Promise.all([
    supabase
      .from("users")
      .select("daily_goal_minutes, settings")
      .eq("id", user.id)
      .single(),
    supabase
      .from("reviews")
      .select("duration_seconds")
      .eq("user_id", user.id)
      .gte("created_at", weekStart),
    supabase
      .from("study_sessions")
      .select("actual_minutes")
      .eq("user_id", user.id)
      .gte("started_at", weekStart),
  ]);

  const profile = profileRes.data;
  const settings = parseSettings(profile?.settings);
  const dailyGoal = profile?.daily_goal_minutes ?? 60;
  const weeklyGoal =
    settings.weekly_goal_minutes ?? dailyGoal * 7;

  const reviewMinutes = Math.round(
    (reviewsRes.data ?? []).reduce((s, r) => s + (r.duration_seconds ?? 0), 0) / 60
  );
  const sessionMinutes = (sessionsRes.data ?? []).reduce(
    (s, sess) => s + (sess.actual_minutes ?? 0),
    0
  );
  const actualMinutes = reviewMinutes + sessionMinutes;
  const compliancePct =
    weeklyGoal > 0 ? Math.min(100, Math.round((actualMinutes / weeklyGoal) * 100)) : 0;

  return Response.json({
    weeklyGoalMinutes: weeklyGoal,
    actualMinutes,
    compliancePct,
    reviewMinutes,
    sessionMinutes,
    dailyGoalMinutes: dailyGoal,
  });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { weekly_goal_minutes } = body;

  if (!weekly_goal_minutes || weekly_goal_minutes < 30 || weekly_goal_minutes > 3000) {
    return Response.json({ error: "Invalid weekly_goal_minutes" }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("users")
    .select("settings")
    .eq("id", user.id)
    .single();

  const settings = parseSettings(profile?.settings);
  settings.weekly_goal_minutes = weekly_goal_minutes;
  settings.week_start_date = getWeekStartISO().split("T")[0];

  const { error } = await supabase
    .from("users")
    .update({ settings })
    .eq("id", user.id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true, weekly_goal_minutes });
}
