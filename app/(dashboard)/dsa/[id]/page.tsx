import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Clock, Star, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AIExplainSection } from "@/components/app/AIExplainSection";
import { ApproachLearnings } from "@/components/app/ApproachLearnings";
import { extractLCSlug } from "@/lib/leetcode";

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

  // Soft-link to problem_bank via slug parsed from the stored URL
  const slug = extractLCSlug(problem.url);
  const { data: bankData } = slug
    ? await supabase
        .from("problem_bank")
        .select("company_tags, acceptance_rate")
        .eq("slug", slug)
        .maybeSingle()
    : { data: null };

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
          {bankData?.acceptance_rate != null && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs">{Number(bankData.acceptance_rate).toFixed(1)}% acceptance</span>
            </div>
          )}
        </div>

        {/* Company tags from problem bank */}
        {bankData?.company_tags && bankData.company_tags.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Building2 className="w-3 h-3" />
              Asked at
            </p>
            <div className="flex flex-wrap gap-1.5">
              {bankData.company_tags.map((company: string) => (
                <Badge
                  key={company}
                  variant="outline"
                  className="text-[11px] border-violet-500/30 text-violet-300 bg-violet-500/10"
                >
                  {company}
                </Badge>
              ))}
            </div>
          </div>
        )}

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

        {/* LeetCode topic tags */}
        {problem.lc_topic_tags && problem.lc_topic_tags.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Topic Tags
            </p>
            <div className="flex flex-wrap gap-1.5">
              {problem.lc_topic_tags.map((tag: string) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="text-[11px] border-border/40 text-muted-foreground/80"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Problem statement from LeetCode */}
      {problem.lc_content && (
        <div className="glass rounded-2xl p-6 mb-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            Problem Statement
          </p>
          <div
            className="lc-prose text-sm text-foreground/90 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: problem.lc_content }}
          />

          {problem.lc_hints && problem.lc_hints.length > 0 && (
            <details className="mt-4 group">
              <summary className="cursor-pointer text-xs font-semibold text-muted-foreground uppercase tracking-wider select-none list-none flex items-center gap-1.5 hover:text-foreground transition-colors">
                <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                Hints ({problem.lc_hints.length})
              </summary>
              <div className="mt-3 space-y-2">
                {problem.lc_hints.map((hint: string, i: number) => (
                  <div
                    key={i}
                    className="text-sm text-muted-foreground bg-surface/50 border border-border/40 rounded-lg px-3 py-2"
                    dangerouslySetInnerHTML={{ __html: hint }}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Approach & Learnings + AI */}
      <div className="glass rounded-2xl p-6 mb-4 space-y-5">
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
