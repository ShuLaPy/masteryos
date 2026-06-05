import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { CalendarCheck, ArrowRight, Brain, Code2, Target } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Weekly Review — MasteryOS" };

export default async function WeeklyReviewPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Get data from the last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const dateStr = sevenDaysAgo.toISOString();

  const [reviews, concepts, problems] = await Promise.all([
    supabase.from("reviews").select("id").eq("user_id", user.id).gte("created_at", dateStr),
    supabase.from("aiml_concepts").select("id").eq("user_id", user.id).gte("created_at", dateStr),
    supabase.from("dsa_problems").select("id").eq("user_id", user.id).gte("solved_at", dateStr),
  ]);

  const reviewCount = reviews.data?.length ?? 0;
  const conceptCount = concepts.data?.length ?? 0;
  const problemCount = problems.data?.length ?? 0;

  return (
    <div className="p-6 max-w-4xl mx-auto min-h-[calc(100vh-48px)] flex flex-col justify-center">
      <div className="text-center mb-12">
        <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center border border-primary/30 glow-violet mx-auto mb-6">
          <CalendarCheck className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-4xl font-bold gradient-text mb-4">Your Week in Review</h1>
        <p className="text-muted-foreground text-lg max-w-lg mx-auto">
          Take a moment to reflect on your progress over the last 7 days. Consistency is the key to mastery.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-6 mb-12">
        <div className="glass rounded-2xl p-8 text-center relative overflow-hidden group hover:border-primary/40 transition-colors">
          <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
          <Brain className="w-8 h-8 text-primary mx-auto mb-4" />
          <p className="text-5xl font-bold text-foreground mb-2">{conceptCount}</p>
          <p className="text-sm font-medium text-muted-foreground">AIML Concepts</p>
        </div>
        
        <div className="glass rounded-2xl p-8 text-center relative overflow-hidden group hover:border-emerald-500/40 transition-colors">
          <div className="absolute inset-0 bg-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
          <Code2 className="w-8 h-8 text-emerald-400 mx-auto mb-4" />
          <p className="text-5xl font-bold text-foreground mb-2">{problemCount}</p>
          <p className="text-sm font-medium text-muted-foreground">DSA Problems</p>
        </div>

        <div className="glass rounded-2xl p-8 text-center relative overflow-hidden group hover:border-violet-500/40 transition-colors">
          <div className="absolute inset-0 bg-violet-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
          <Target className="w-8 h-8 text-violet-400 mx-auto mb-4" />
          <p className="text-5xl font-bold text-foreground mb-2">{reviewCount}</p>
          <p className="text-sm font-medium text-muted-foreground">Flashcards Reviewed</p>
        </div>
      </div>

      <div className="glass rounded-2xl p-8 max-w-2xl mx-auto w-full text-center">
        <h2 className="text-xl font-bold text-foreground mb-2">Ready for next week?</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Set your intentions and adjust your daily goals. The Mentor is ready to guide you.
        </p>
        <Link href="/">
          <Button className="bg-primary hover:bg-primary/90 text-primary-foreground glow-violet w-full max-w-xs">
            Return to Dashboard <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
