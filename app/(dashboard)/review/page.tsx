import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ReviewClient from "@/components/app/ReviewClient";
import type { ResolveProblem } from "@/components/app/ResolveLadderCard";
import { DISPLAY_TO_CANONICAL } from "@/lib/constants";

export const metadata = { title: "Daily Review — MasteryOS" };

export default async function ReviewPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: dueCards } = await supabase
    .from("srs_cards")
    .select("*")
    .eq("user_id", user.id)
    .lte("due", new Date().toISOString())
    .order("due", { ascending: true })
    .limit(50);

  // Fetch the problems behind any due re-solve cards so the ladder can render.
  const resolveIds = [
    ...new Set(
      (dueCards ?? [])
        .filter((c) => c.source_type === "dsa_resolve")
        .map((c) => c.source_id),
    ),
  ];

  const resolveProblems: Record<string, ResolveProblem> = {};
  if (resolveIds.length > 0) {
    const { data: problems } = await supabase
      .from("dsa_problems")
      .select("id, title, url, difficulty, patterns, ai_explanation")
      .eq("user_id", user.id)
      .in("id", resolveIds);

    for (const p of problems ?? []) {
      const diff = (p.difficulty ?? "").toLowerCase();
      const canonical = [
        ...new Set(
          ((p.patterns as string[] | null) ?? [])
            .map((d) => DISPLAY_TO_CANONICAL[d])
            .filter((c): c is string => Boolean(c)),
        ),
      ];
      resolveProblems[p.id] = {
        id: p.id,
        title: p.title,
        url: p.url,
        difficulty: diff === "easy" || diff === "hard" ? diff : "medium",
        patterns: canonical,
        ai_explanation: p.ai_explanation,
      };
    }
  }

  return (
    <ReviewClient
      cards={dueCards ?? []}
      userId={user.id}
      resolveProblems={resolveProblems}
    />
  );
}
