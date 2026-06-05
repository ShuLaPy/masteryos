import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import MentorHomeClient from "@/components/app/MentorHomeClient";

export const metadata = {
  title: "AI Mentor — MasteryOS",
};

export default async function MentorHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Fetch all context for the mentor in parallel
  const [profileRes, dueRes, weakAIML, weakDSA, planRes] = await Promise.all([
    supabase
      .from("users")
      .select("display_name, streak_count, daily_goal_minutes")
      .eq("id", user.id)
      .single(),
    supabase
      .from("srs_cards")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .lte("due", new Date().toISOString()),
    supabase
      .from("aiml_concepts")
      .select("title, mastery_score")
      .eq("user_id", user.id)
      .order("mastery_score", { ascending: true })
      .limit(1)
      .single(),
    supabase
      .from("dsa_problems")
      .select("patterns, solved_at")
      .eq("user_id", user.id)
      .order("solved_at", { ascending: false })
      .limit(10),
    supabase
      .from("daily_plans")
      .select("mentor_message, generated_plan, completion_pct")
      .eq("user_id", user.id)
      .eq("plan_date", new Date().toISOString().split("T")[0])
      .single(),
  ]);

  const ctx = {
    userId: user.id,
    displayName: profileRes.data?.display_name ?? "Learner",
    streakCount: profileRes.data?.streak_count ?? 0,
    goalMinutes: profileRes.data?.daily_goal_minutes ?? 60,
    dueCount: dueRes.count ?? 0,
    weakestConcept: weakAIML.data
      ? {
          title: weakAIML.data.title,
          mastery: Math.round((weakAIML.data.mastery_score ?? 0) * 100),
        }
      : null,
    lastDSASolvedAt: weakDSA.data?.[0]?.solved_at ?? null,
    mentorMessage: planRes.data?.mentor_message ?? null,
    completionPct: planRes.data?.completion_pct ?? 0,
  };

  return <MentorHomeClient ctx={ctx} />;
}
