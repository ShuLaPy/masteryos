import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Code2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Logged Problems — DSA Track — MasteryOS" };

function difficultyColor(diff: string) {
  if (diff === "easy") return "text-emerald-400 bg-emerald-500/15 border-emerald-500/25";
  if (diff === "medium") return "text-amber-400 bg-amber-500/15 border-amber-500/25";
  return "text-red-400 bg-red-500/15 border-red-500/25";
}

export default async function DSAProblemsListPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: problems } = await supabase
    .from("dsa_problems")
    .select("id, title, url, difficulty, patterns, confidence, time_taken_minutes, solved_at")
    .eq("user_id", user.id)
    .order("solved_at", { ascending: false });

  const list = problems ?? [];

  // Build pattern → problem count map
  const patternCounts = new Map<string, number>();
  for (const p of list) {
    for (const pat of (p.patterns as string[] | null) ?? []) {
      patternCounts.set(pat, (patternCounts.get(pat) ?? 0) + 1);
    }
  }
  const sortedPatterns = [...patternCounts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Link href="/dsa">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Code2 className="w-5 h-5 text-emerald-400" /> Logged Problems
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {list.length} problem{list.length !== 1 ? "s" : ""} · {sortedPatterns.length} pattern{sortedPatterns.length !== 1 ? "s" : ""} explored
            </p>
          </div>
        </div>
        <Link href="/dsa/log">
          <Button className="bg-emerald-500 hover:bg-emerald-600 text-white">
            <Plus className="w-4 h-4 mr-2" /> Log Problem
          </Button>
        </Link>
      </div>

      {list.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <Code2 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-foreground font-medium mb-1">No problems logged yet</p>
          <p className="text-sm text-muted-foreground mb-4">
            Start by logging your first DSA problem to track your pattern mastery.
          </p>
          <Link href="/dsa/log">
            <Button className="bg-emerald-500 hover:bg-emerald-600 text-white">
              <Plus className="w-4 h-4 mr-2" /> Log your first problem
            </Button>
          </Link>
        </div>
      ) : (
        <>
          {/* Pattern breakdown */}
          {sortedPatterns.length > 0 && (
            <div className="glass rounded-xl p-4 mb-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Patterns explored
              </p>
              <div className="flex flex-wrap gap-2">
                {sortedPatterns.map(([pat, count]) => (
                  <div
                    key={pat}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px]"
                  >
                    <span className="text-emerald-300 font-medium">{pat}</span>
                    <span className="text-emerald-400/60 font-bold">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Problem list */}
          <div className="space-y-2">
            {list.map((p) => (
              <div key={p.id} className="glass rounded-xl p-4 hover:border-primary/30 border border-transparent transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Link
                        href={`/dsa/${p.id}`}
                        className="font-medium text-foreground truncate hover:text-primary transition-colors"
                      >
                        {p.title}
                      </Link>
                      {p.url && (
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 text-muted-foreground hover:text-emerald-400 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                    {p.patterns && (p.patterns as string[]).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(p.patterns as string[]).map((pat) => (
                          <Badge
                            key={pat}
                            variant="outline"
                            className="text-[10px] border-border/50 text-muted-foreground py-0 px-1.5"
                          >
                            {pat}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {p.time_taken_minutes && (
                      <span className="text-xs text-muted-foreground">{p.time_taken_minutes}m</span>
                    )}
                    <Badge
                      className={`capitalize text-xs px-2 py-0.5 border ${difficultyColor(p.difficulty ?? "medium")}`}
                    >
                      {p.difficulty}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(p.solved_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
