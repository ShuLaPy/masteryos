import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import MentorHomeClient from "@/components/app/MentorHomeClient";
import { getWeekStartISO, parseSettings } from "@/lib/accountability";

export const metadata = {
  title: "AI Mentor — MasteryOS",
};

export default async function MentorHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const weekStart = getWeekStartISO();

  // Fetch all context for the mentor in parallel
  const [profileRes, dueRes, weakAIML, dsaRes, planRes, reviewStatsRes, weeklyActivityRes, weekReviewsRes, weekSessionsRes] = await Promise.all([
    supabase
      .from("users")
      .select("display_name, streak_count, daily_goal_minutes, settings")
      .eq("id", user.id)
      .single(),
    supabase
      .from("srs_cards")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .lte("due", new Date().toISOString()),
    // Fetch top 3 weakest concepts instead of just 1
    supabase
      .from("aiml_concepts")
      .select("title, mastery_score")
      .eq("user_id", user.id)
      .order("mastery_score", { ascending: true })
      .limit(3),
    // Fetch recent DSA problems with patterns for gap analysis
    supabase
      .from("dsa_problems")
      .select("patterns, solved_at, difficulty")
      .eq("user_id", user.id)
      .gte("solved_at", sevenDaysAgo)
      .order("solved_at", { ascending: false }),
    supabase
      .from("daily_plans")
      .select("mentor_message, generated_plan, completion_pct")
      .eq("user_id", user.id)
      .eq("plan_date", new Date().toISOString().split("T")[0])
      .single(),
    // Review performance: avg stability, total lapses, recent card states
    supabase
      .from("srs_cards")
      .select("stability, lapses, reps, state, last_review")
      .eq("user_id", user.id)
      .not("last_review", "is", null),
    // Weekly activity: count of cards reviewed in last 7 days
    supabase
      .from("srs_cards")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("last_review", sevenDaysAgo),
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

  // Build DSA pattern frequency map
  const patternCounts: Record<string, number> = {};
  let lastDSASolvedAt: string | null = null;
  if (dsaRes.data && dsaRes.data.length > 0) {
    lastDSASolvedAt = dsaRes.data[0].solved_at;
    for (const problem of dsaRes.data) {
      const patterns = problem.patterns as string[] | null;
      if (patterns) {
        for (const p of patterns) {
          patternCounts[p] = (patternCounts[p] || 0) + 1;
        }
      }
    }
  }

  // Compute review performance stats
  let avgStability = 0;
  let totalLapses = 0;
  let totalReps = 0;
  let matureCardCount = 0;
  const reviewedCards = reviewStatsRes.data ?? [];
  if (reviewedCards.length > 0) {
    let stabilitySum = 0;
    for (const card of reviewedCards) {
      stabilitySum += card.stability ?? 0;
      totalLapses += card.lapses ?? 0;
      totalReps += card.reps ?? 0;
      if (card.state === "review" && (card.stability ?? 0) > 10) {
        matureCardCount++;
      }
    }
    avgStability = Math.round((stabilitySum / reviewedCards.length) * 10) / 10;
  }

  // Build weakest concepts array
  const weakestConcepts = (weakAIML.data ?? []).map((c) => ({
    title: c.title,
    mastery: Math.round((c.mastery_score ?? 0) * 100),
  }));

  const settings = parseSettings(profileRes.data?.settings);
  const dailyGoal = profileRes.data?.daily_goal_minutes ?? 60;
  const weeklyGoalMinutes = settings.weekly_goal_minutes ?? dailyGoal * 7;
  const reviewMinutes = Math.round(
    (weekReviewsRes.data ?? []).reduce((s, r) => s + (r.duration_seconds ?? 0), 0) / 60
  );
  const sessionMinutes = (weekSessionsRes.data ?? []).reduce(
    (s, sess) => s + (sess.actual_minutes ?? 0),
    0
  );
  const commitmentActualMinutes = reviewMinutes + sessionMinutes;
  const commitmentCompliancePct =
    weeklyGoalMinutes > 0
      ? Math.min(100, Math.round((commitmentActualMinutes / weeklyGoalMinutes) * 100))
      : 0;

  const ctx = {
    userId: user.id,
    displayName: profileRes.data?.display_name ?? "Learner",
    streakCount: profileRes.data?.streak_count ?? 0,
    goalMinutes: profileRes.data?.daily_goal_minutes ?? 60,
    dueCount: dueRes.count ?? 0,
    // Keep backwards-compatible single weakest concept for UI
    weakestConcept: weakestConcepts.length > 0 ? weakestConcepts[0] : null,
    // New: full list for mentor prompt
    weakestConcepts,
    lastDSASolvedAt,
    mentorMessage: planRes.data?.mentor_message ?? null,
    completionPct: planRes.data?.completion_pct ?? 0,
    generatedPlan: planRes.data?.generated_plan ?? null,
    // New enriched data
    dsaPatterns: patternCounts,
    dsaProblemCount7d: dsaRes.data?.length ?? 0,
    reviewStats: {
      totalCards: reviewedCards.length,
      avgStability,
      totalLapses,
      totalReps,
      matureCardCount,
      successRate: totalReps > 0 ? Math.round(((totalReps - totalLapses) / totalReps) * 100) : 0,
    },
    weeklyCardsReviewed: weeklyActivityRes.count ?? 0,
    commitment: {
      weeklyGoalMinutes,
      actualMinutes: commitmentActualMinutes,
      compliancePct: commitmentCompliancePct,
    },
  };

  return <MentorHomeClient ctx={ctx} />;
}
