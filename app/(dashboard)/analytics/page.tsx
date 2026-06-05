import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AnalyticsDashboardClient from "@/components/app/analytics/AnalyticsDashboardClient";
import {
  computeKPIs,
  getCalibrationData,
  getConceptGraph,
  getConceptRetentionGrid,
  getPacePrediction,
  getPatternBreakdown,
  getProgressTimeline,
  getReviewForecast,
  getStudyActivity,
  type ConceptRecord,
  type DSAProblemRecord,
  type ReviewRecord,
  type SRSCardRecord,
} from "@/lib/analytics";

export const metadata = { title: "Analytics — MasteryOS" };

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profileRes, cardsRes, reviewsRes, conceptsRes, problemsRes] =
    await Promise.all([
      supabase
        .from("users")
        .select("streak_count, created_at")
        .eq("id", user.id)
        .single(),
      supabase
        .from("srs_cards")
        .select(
          "source_id, source_type, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review"
        )
        .eq("user_id", user.id),
      supabase
        .from("reviews")
        .select(
          "rating, duration_seconds, created_at, confidence_predicted, retrievability_at_review"
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("aiml_concepts")
        .select("id, title, mastery_score, prerequisites, created_at")
        .eq("user_id", user.id),
      supabase
        .from("dsa_problems")
        .select("patterns, confidence, solved_at")
        .eq("user_id", user.id),
    ]);

  const profile = profileRes.data;
  const cards = (cardsRes.data ?? []) as SRSCardRecord[];
  const reviews = (reviewsRes.data ?? []) as ReviewRecord[];
  const concepts = (conceptsRes.data ?? []) as ConceptRecord[];
  const problems = (problemsRes.data ?? []) as DSAProblemRecord[];

  const accountStart = profile?.created_at ?? new Date().toISOString();

  const data = {
    kpis: computeKPIs(profile, cards, reviews, concepts, problems),
    retentionGrid: getConceptRetentionGrid(concepts, cards),
    timeline: getProgressTimeline(accountStart, concepts, problems, reviews),
    patternBreakdown: getPatternBreakdown(problems),
    graph: getConceptGraph(concepts),
    calibration: getCalibrationData(reviews),
    studyActivity: getStudyActivity(reviews),
    forecast: getReviewForecast(cards),
    pace: getPacePrediction(problems, accountStart),
  };

  return <AnalyticsDashboardClient data={data} />;
}
