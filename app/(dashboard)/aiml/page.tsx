import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Cpu, Search, BookOpen, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

export const metadata = { title: "AIML Track — MasteryOS" };

function masteryColor(score: number) {
  if (score >= 0.8) return "text-emerald-400";
  if (score >= 0.5) return "text-amber-400";
  if (score >= 0.2) return "text-orange-400";
  return "text-red-400";
}

function masteryBg(score: number) {
  if (score >= 0.8) return "bg-emerald-500/10 border-emerald-500/20";
  if (score >= 0.5) return "bg-amber-500/10 border-amber-500/20";
  if (score >= 0.2) return "bg-orange-500/10 border-orange-500/20";
  return "bg-red-500/10 border-red-500/20";
}

export default async function AIMLTrackPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [conceptsRes, cardCountRes] = await Promise.all([
    supabase
      .from("aiml_concepts")
      .select("id, title, concept_type, week_number, mastery_score, tags, created_at, source")
      .eq("user_id", user.id)
      .order("week_number", { ascending: true })
      .order("created_at", { ascending: false }),
    supabase
      .from("srs_cards")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("source_type", "aiml_concept"),
  ]);

  const concepts = conceptsRes.data ?? [];
  const totalCards = cardCountRes.count ?? 0;
  const avgMastery =
    concepts.length > 0
      ? concepts.reduce((s, c) => s + (c.mastery_score ?? 0), 0) / concepts.length
      : 0;

  // Group by week
  const byWeek = concepts.reduce<Record<number, typeof concepts>>((acc, c) => {
    const w = c.week_number ?? 0;
    if (!acc[w]) acc[w] = [];
    acc[w].push(c);
    return acc;
  }, {});

  const typeColors: Record<string, string> = {
    theory: "bg-blue-500/15 text-blue-300 border-blue-500/25",
    math: "bg-violet-500/15 text-violet-300 border-violet-500/25",
    implementation: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
    system: "bg-amber-500/15 text-amber-300 border-amber-500/25",
    all: "bg-pink-500/15 text-pink-300 border-pink-500/25",
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Cpu className="w-6 h-6 text-primary" /> AIML Track
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Your machine learning and AI knowledge vault
          </p>
        </div>
        <Link href="/aiml/new">
          <Button className="bg-primary hover:bg-primary/90 glow-violet">
            <Plus className="w-4 h-4 mr-2" /> Add Concept
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="glass rounded-xl p-4">
          <p className="text-2xl font-bold text-foreground">{concepts.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Concepts logged</p>
        </div>
        <div className="glass rounded-xl p-4">
          <p className="text-2xl font-bold text-foreground">{totalCards}</p>
          <p className="text-xs text-muted-foreground mt-1">SRS cards generated</p>
        </div>
        <div className="glass rounded-xl p-4">
          <p className={`text-2xl font-bold ${masteryColor(avgMastery)}`}>
            {Math.round(avgMastery * 100)}%
          </p>
          <p className="text-xs text-muted-foreground mt-1">Average mastery</p>
          <Progress value={avgMastery * 100} className="mt-2 h-1 bg-secondary" />
        </div>
      </div>

      {/* Empty state */}
      {concepts.length === 0 && (
        <div className="text-center py-20 glass rounded-2xl">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">Log your first concept</h2>
          <p className="text-muted-foreground text-sm mb-6 max-w-sm mx-auto">
            After each study session, log the key concepts you learned. The AI will auto-generate SRS flashcards for you.
          </p>
          <Link href="/aiml/new">
            <Button className="bg-primary hover:bg-primary/90">
              <Plus className="w-4 h-4 mr-2" /> Add your first concept
            </Button>
          </Link>
        </div>
      )}

      {/* Grouped by week */}
      {Object.keys(byWeek)
        .map(Number)
        .sort((a, b) => a - b)
        .map((week) => (
          <div key={week} className="mb-8">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center text-xs font-bold text-primary">
                W{week}
              </div>
              <h2 className="text-sm font-semibold text-foreground">Week {week}</h2>
              <div className="flex-1 h-px bg-border/40" />
              <span className="text-xs text-muted-foreground">
                {byWeek[week].length} concept{byWeek[week].length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex flex-col gap-3">
              {byWeek[week].map((concept) => (
                <Link key={concept.id} href={`/aiml/${concept.id}`} className="block">
                  <div className="glass rounded-xl p-4 flex items-center gap-4 hover:border-primary/30 transition-all group">
                    <div className={`w-2 h-2 rounded-full ${masteryColor(concept.mastery_score ?? 0).replace("text-", "bg-")}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                          {concept.title}
                        </h3>
                        {concept.concept_type && (
                          <Badge className={`text-[10px] px-1.5 py-0 h-4 border ${typeColors[concept.concept_type] ?? typeColors.all}`}>
                            {concept.concept_type}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {(concept.tags ?? []).slice(0, 3).map((tag: string) => (
                          <span key={tag} className="text-[10px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-semibold ${masteryColor(concept.mastery_score ?? 0)}`}>
                        {Math.round((concept.mastery_score ?? 0) * 100)}%
                      </p>
                      <p className="text-[10px] text-muted-foreground">mastery</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
