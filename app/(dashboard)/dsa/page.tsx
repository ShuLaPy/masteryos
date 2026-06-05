import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Code2, Sparkles, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

export const metadata = { title: "DSA Track — MasteryOS" };

import { DSA_PATTERNS } from "@/lib/constants";

function difficultyColor(diff: string) {
  if (diff === "easy") return "text-emerald-400 bg-emerald-500/15 border-emerald-500/25";
  if (diff === "medium") return "text-amber-400 bg-amber-500/15 border-amber-500/25";
  return "text-red-400 bg-red-500/15 border-red-500/25";
}

export default async function DSATrackPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [problemsRes, cardCountRes] = await Promise.all([
    supabase
      .from("dsa_problems")
      .select("*")
      .eq("user_id", user.id)
      .order("solved_at", { ascending: false }),
    supabase
      .from("srs_cards")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("source_type", "dsa_problem"),
  ]);

  const problems = problemsRes.data ?? [];
  const totalCards = cardCountRes.count ?? 0;

  // Calculate pattern mastery stats
  const patternStats = DSA_PATTERNS.map((p) => {
    const pProbs = problems.filter((prob) => (prob.patterns ?? []).includes(p));
    const count = pProbs.length;
    const avgConfidence = count > 0 ? pProbs.reduce((acc, curr) => acc + (curr.confidence ?? 0), 0) / count : 0;
    return { pattern: p, count, avgConfidence };
  }).sort((a, b) => b.count - a.count); // Sort by most practiced

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Code2 className="w-6 h-6 text-emerald-400" /> DSA Track
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track your problem solving patterns and retention
          </p>
        </div>
        <Link href="/dsa/log">
          <Button className="bg-emerald-500 hover:bg-emerald-600 text-white glow-emerald">
            <Plus className="w-4 h-4 mr-2" /> Log Problem
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="glass rounded-xl p-4">
          <p className="text-2xl font-bold text-foreground">{problems.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Problems solved</p>
        </div>
        <div className="glass rounded-xl p-4">
          <p className="text-2xl font-bold text-foreground">{totalCards}</p>
          <p className="text-xs text-muted-foreground mt-1">SRS cards generated</p>
        </div>
        <div className="glass rounded-xl p-4">
          <p className="text-2xl font-bold text-emerald-400">
            {patternStats.filter(p => p.count > 0).length} / 25
          </p>
          <p className="text-xs text-muted-foreground mt-1">Patterns explored</p>
          <Progress value={(patternStats.filter(p => p.count > 0).length / 25) * 100} className="mt-2 h-1 bg-secondary" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Main List */}
        <div className="md:col-span-2 space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Recent Problems
          </h2>
          
          {problems.length === 0 && (
            <div className="text-center py-12 glass rounded-2xl">
              <Code2 className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No problems logged yet.</p>
            </div>
          )}

          {problems.map((prob) => (
            <div key={prob.id} className="glass rounded-xl p-4 hover:border-emerald-500/30 transition-colors">
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-foreground">{prob.title}</h3>
                  {prob.url && (
                    <a href={prob.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-emerald-400">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={`capitalize text-[10px] px-1.5 py-0 h-4 border ${difficultyColor(prob.difficulty)}`}>
                    {prob.difficulty}
                  </Badge>
                  <span className="text-xs font-bold text-foreground bg-secondary px-2 py-0.5 rounded-md">
                    {prob.confidence}/5
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {(prob.patterns ?? []).map((p: string) => (
                  <Badge key={p} variant="outline" className="text-[10px] border-border/60 text-muted-foreground">
                    {p}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Pattern Mastery Sidebar */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            Pattern Mastery
          </h2>
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
            {patternStats.map((stat) => (
              <div key={stat.pattern} className="glass rounded-lg p-3">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-medium text-foreground">{stat.pattern}</span>
                  <span className="text-[10px] text-muted-foreground">{stat.count} solved</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all ${stat.avgConfidence >= 4 ? 'bg-emerald-400' : stat.avgConfidence >= 2.5 ? 'bg-amber-400' : 'bg-red-400'}`}
                      style={{ width: `${(stat.avgConfidence / 5) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] w-6 text-right font-medium text-foreground">
                    {stat.count > 0 ? stat.avgConfidence.toFixed(1) : '-'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
