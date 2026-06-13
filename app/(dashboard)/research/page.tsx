import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ResearchClient from "@/components/app/ResearchClient";
import type { PaperRecommendation } from "@/lib/paper-recommender";

export const metadata = { title: "Research Papers — MasteryOS" };

export default async function ResearchPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [recsRes, learnedRes] = await Promise.all([
    supabase
      .from("paper_recommendations")
      .select("*")
      .eq("user_id", user.id)
      .order("reading_order", { ascending: true, nullsFirst: false })
      .order("relevance_score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("aiml_concepts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("card_status", ["seeded", "learned"]),
  ]);

  const recommendations = (recsRes.data ?? []) as unknown as PaperRecommendation[];
  const learnedCount = learnedRes.count ?? 0;

  return (
    <ResearchClient
      initialRecommendations={recommendations}
      learnedCount={learnedCount}
    />
  );
}
