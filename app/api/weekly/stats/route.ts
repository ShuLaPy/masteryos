import { createClient } from "@/lib/supabase/server";
import { getWeekStartISO } from "@/lib/accountability";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const weekStart = getWeekStartISO();
  const weekStartDate = weekStart.split("T")[0];

  const [reviewsRes, conceptsRes, problemsRes, sessionsRes, synthesisRes] =
    await Promise.all([
      supabase
        .from("reviews")
        .select("id, duration_seconds, rating, retrievability_at_review")
        .eq("user_id", user.id)
        .gte("created_at", weekStart),
      supabase
        .from("aiml_concepts")
        .select("id, title, mastery_score, created_at")
        .eq("user_id", user.id)
        .gte("created_at", weekStart),
      supabase
        .from("dsa_problems")
        .select("id, title, difficulty, patterns, solved_at")
        .eq("user_id", user.id)
        .gte("solved_at", weekStart),
      supabase
        .from("study_sessions")
        .select("actual_minutes, cards_reviewed")
        .eq("user_id", user.id)
        .gte("started_at", weekStart),
      supabase
        .from("weekly_syntheses")
        .select("ai_synthesis, week_start_date")
        .eq("user_id", user.id)
        .eq("week_start_date", weekStartDate)
        .maybeSingle(),
    ]);

  const reviews = reviewsRes.data ?? [];
  const concepts = conceptsRes.data ?? [];
  const problems = problemsRes.data ?? [];
  const sessions = sessionsRes.data ?? [];

  const reviewMinutes = Math.round(
    reviews.reduce((s, r) => s + (r.duration_seconds ?? 0), 0) / 60
  );
  const sessionMinutes = sessions.reduce((s, sess) => s + (sess.actual_minutes ?? 0), 0);
  const avgRetention =
    reviews.length > 0
      ? reviews.reduce((s, r) => s + (r.retrievability_at_review ?? 0), 0) / reviews.length
      : 0;

  return Response.json({
    weekStartDate,
    reviewCount: reviews.length,
    conceptCount: concepts.length,
    problemCount: problems.length,
    totalMinutes: reviewMinutes + sessionMinutes,
    avgRetention: Math.round(avgRetention * 100),
    concepts,
    problems,
    existingSynthesis: synthesisRes.data?.ai_synthesis ?? null,
  });
}
