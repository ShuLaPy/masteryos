import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Clock, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AIExplainSection } from "@/components/app/AIExplainSection";
import { ApproachLearnings } from "@/components/app/ApproachLearnings";

export const metadata = { title: "Problem Detail — MasteryOS" };

function difficultyColor(diff: string) {
  if (diff === "easy") return "text-emerald-400 bg-emerald-500/15 border-emerald-500/25";
  if (diff === "medium") return "text-amber-400 bg-amber-500/15 border-amber-500/25";
  return "text-red-400 bg-red-500/15 border-red-500/25";
}

function confidenceLabel(c: number) {
  if (c === 1) return "Confused";
  if (c === 2) return "Shaky";
  if (c === 3) return "Okay";
  if (c === 4) return "Solid";
  return "Mastered";
}

export default async function DSAProblemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: problem } = await supabase
    .from("dsa_problems")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!problem) notFound();

  const solvedAt = new Date(problem.solved_at ?? problem.created_at);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Back */}
      <div className="flex items-center gap-3 mb-8">
        <Link href="/dsa">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-foreground">Problem Details</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Your logged approach and learnings</p>
        </div>
      </div>

      {/* Title row */}
      <div className="glass rounded-2xl p-6 mb-4 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-foreground truncate">{problem.title}</h2>
            {problem.url && (
              <a
                href={problem.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-muted-foreground hover:text-emerald-400 transition-colors"
                aria-label="Open problem on LeetCode"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
          <Badge
            className={`capitalize text-xs px-2 py-0.5 border shrink-0 ${difficultyColor(problem.difficulty)}`}
          >
            {problem.difficulty}
          </Badge>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5" />
            <span>
              {problem.confidence}/5 — {confidenceLabel(problem.confidence)}
            </span>
          </div>
          {problem.time_taken_minutes && (
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              <span>{problem.time_taken_minutes} min</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span>
              Solved{" "}
              {solvedAt.toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        </div>

        {/* Patterns */}
        {problem.patterns && problem.patterns.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Patterns
            </p>
            <div className="flex flex-wrap gap-1.5">
              {problem.patterns.map((p: string) => (
                <Badge
                  key={p}
                  variant="outline"
                  className="text-[11px] border-border/60 text-muted-foreground"
                >
                  {p}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Approach & Learnings */}
        <ApproachLearnings problemId={problem.id} initialNotes={problem.approach_notes} />

        {/* AI Explain */}
        <div className="pt-1">
          <AIExplainSection problemId={problem.id} />
        </div>
      </div>

      <div className="flex justify-end">
        <Link href="/dsa">
          <Button variant="outline">Back to DSA Track</Button>
        </Link>
      </div>
    </div>
  );
}
