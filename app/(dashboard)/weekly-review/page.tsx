import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import WeeklyReviewWizard from "@/components/app/WeeklyReviewWizard";
import { getWeekStartISO, parseSettings } from "@/lib/accountability";

export const metadata = { title: "Weekly Review — MasteryOS" };

export default async function WeeklyReviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const weekStart = getWeekStartISO();
  const weekStartDate = weekStart.split("T")[0];

  const [profileRes, allConceptsRes] = await Promise.all([
    supabase
      .from("users")
      .select("daily_goal_minutes, settings")
      .eq("id", user.id)
      .single(),
    supabase.from("aiml_concepts").select("id, title").eq("user_id", user.id).order("title"),
  ]);

  const [reviewsRes, conceptsRes, problemsRes, synthesisRes] = await Promise.all([
    supabase
      .from("reviews")
      .select("id, duration_seconds, retrievability_at_review")
      .eq("user_id", user.id)
      .gte("created_at", weekStart),
    supabase
      .from("aiml_concepts")
      .select("id, title, mastery_score, created_at")
      .eq("user_id", user.id)
      .gte("created_at", weekStart),
    supabase
      .from("dsa_problems")
      .select("id, title, difficulty")
      .eq("user_id", user.id)
      .gte("solved_at", weekStart),
    supabase
      .from("weekly_syntheses")
      .select("ai_synthesis")
      .eq("user_id", user.id)
      .eq("week_start_date", weekStartDate)
      .maybeSingle(),
  ]);

  const reviews = reviewsRes.data ?? [];
  const concepts = conceptsRes.data ?? [];
  const problems = problemsRes.data ?? [];
  const profile = profileRes.data;
  const settings = parseSettings(profile?.settings);
  const dailyGoal = profile?.daily_goal_minutes ?? 60;
  const weeklyGoal = settings.weekly_goal_minutes ?? dailyGoal * 7;

  const reviewMinutes = Math.round(
    reviews.reduce((s, r) => s + (r.duration_seconds ?? 0), 0) / 60
  );
  const avgRetention =
    reviews.length > 0
      ? Math.round(
          (reviews.reduce((s, r) => s + (r.retrievability_at_review ?? 0), 0) / reviews.length) * 100
        )
      : 0;

  return (
    <WeeklyReviewWizard
      weekStartDate={weekStartDate}
      reviewCount={reviews.length}
      conceptCount={concepts.length}
      problemCount={problems.length}
      totalMinutes={reviewMinutes}
      avgRetention={avgRetention}
      weekConcepts={concepts}
      allConcepts={allConceptsRes.data ?? []}
      existingSynthesis={synthesisRes.data?.ai_synthesis ?? null}
      dailyGoalMinutes={dailyGoal}
      weeklyGoalMinutes={weeklyGoal}
    />
  );
}
