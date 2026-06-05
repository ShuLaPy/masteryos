import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { BarChart3, Brain, Target, Zap, Clock, Code2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export const metadata = { title: "Analytics — MasteryOS" };

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch massive context for analytics
  const [profile, cards, reviews, concepts, problems] = await Promise.all([
    supabase.from("users").select("*").eq("id", user.id).single(),
    supabase.from("srs_cards").select("state, stability, difficulty").eq("user_id", user.id),
    supabase.from("reviews").select("rating, duration_seconds, created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("aiml_concepts").select("mastery_score, week_number").eq("user_id", user.id),
    supabase.from("dsa_problems").select("difficulty, confidence").eq("user_id", user.id)
  ]);

  const totalCards = cards.data?.length ?? 0;
  const learningCards = cards.data?.filter(c => c.state === "learning" || c.state === "relearning").length ?? 0;
  const reviewCards = cards.data?.filter(c => c.state === "review").length ?? 0;
  
  // Calculate average retention (retrievability approximation based on stability)
  const avgStability = totalCards > 0 ? (cards.data?.reduce((sum, c) => sum + (c.stability ?? 0), 0) ?? 0) / totalCards : 0;
  
  // Reviews stats
  const totalReviews = reviews.data?.length ?? 0;
  const timeSpentSecs = reviews.data?.reduce((sum, r) => sum + (r.duration_seconds ?? 0), 0) ?? 0;
  const timeSpentMins = Math.round(timeSpentSecs / 60);

  // Concept stats
  const totalConcepts = concepts.data?.length ?? 0;
  const avgMastery = totalConcepts > 0 ? (concepts.data?.reduce((sum, c) => sum + (c.mastery_score ?? 0), 0) ?? 0) / totalConcepts : 0;

  // DSA stats
  const totalDSA = problems.data?.length ?? 0;
  const avgDSAConf = totalDSA > 0 ? (problems.data?.reduce((sum, p) => sum + (p.confidence ?? 0), 0) ?? 0) / totalDSA : 0;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center border border-primary/30 glow-violet">
          <BarChart3 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Data-driven insights into your learning progress
          </p>
        </div>
      </div>

      {/* Top Level KPIs */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="glass rounded-xl p-5">
          <div className="flex items-center gap-2 text-primary mb-2">
            <Zap className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase tracking-wider">Current Streak</span>
          </div>
          <p className="text-3xl font-bold text-foreground">{profile.data?.streak_count ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1">Days in a row</p>
        </div>
        
        <div className="glass rounded-xl p-5">
          <div className="flex items-center gap-2 text-violet-400 mb-2">
            <Brain className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase tracking-wider">Memory State</span>
          </div>
          <p className="text-3xl font-bold text-foreground">{reviewCards}</p>
          <p className="text-xs text-muted-foreground mt-1">Cards in mature review</p>
        </div>

        <div className="glass rounded-xl p-5">
          <div className="flex items-center gap-2 text-emerald-400 mb-2">
            <Clock className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase tracking-wider">Time Invested</span>
          </div>
          <p className="text-3xl font-bold text-foreground">{timeSpentMins}</p>
          <p className="text-xs text-muted-foreground mt-1">Minutes active reviewing</p>
        </div>

        <div className="glass rounded-xl p-5">
          <div className="flex items-center gap-2 text-amber-400 mb-2">
            <Target className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase tracking-wider">Total Reps</span>
          </div>
          <p className="text-3xl font-bold text-foreground">{totalReviews}</p>
          <p className="text-xs text-muted-foreground mt-1">Flashcard reviews</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Memory Distribution */}
        <div className="glass rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-foreground mb-4">Memory Distribution</h2>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">Learning (New)</span>
                <span className="font-medium">{learningCards}</span>
              </div>
              <Progress value={totalCards > 0 ? (learningCards/totalCards)*100 : 0} className="h-2 bg-secondary" />
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">Review (Mature)</span>
                <span className="font-medium text-primary">{reviewCards}</span>
              </div>
              <Progress value={totalCards > 0 ? (reviewCards/totalCards)*100 : 0} className="h-2 bg-primary/20" />
            </div>
          </div>
          <div className="mt-6 p-4 rounded-xl bg-secondary/30 border border-border/60">
            <p className="text-xs text-muted-foreground">
              Average memory stability is <span className="font-semibold text-foreground">{avgStability.toFixed(1)} days</span>. 
              This means you'll remember an average card for this long before forgetting it.
            </p>
          </div>
        </div>

        {/* Domain Mastery */}
        <div className="glass rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-foreground mb-4">Domain Mastery</h2>
          <div className="grid grid-cols-2 gap-4 h-full pb-8">
            <div className="flex flex-col items-center justify-center p-4 rounded-xl border border-border/40 bg-secondary/20">
              <Brain className="w-8 h-8 text-violet-400 mb-3" />
              <p className="text-2xl font-bold text-foreground">{Math.round(avgMastery * 100)}%</p>
              <p className="text-xs text-muted-foreground mt-1">AIML Mastery</p>
              <p className="text-[10px] text-muted-foreground mt-1">{totalConcepts} concepts</p>
            </div>
            <div className="flex flex-col items-center justify-center p-4 rounded-xl border border-border/40 bg-secondary/20">
              <Code2 className="w-8 h-8 text-emerald-400 mb-3" />
              <p className="text-2xl font-bold text-foreground">{avgDSAConf.toFixed(1)}<span className="text-sm text-muted-foreground">/5</span></p>
              <p className="text-xs text-muted-foreground mt-1">DSA Confidence</p>
              <p className="text-[10px] text-muted-foreground mt-1">{totalDSA} problems</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
