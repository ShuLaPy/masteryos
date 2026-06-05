import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Sidebar from "@/components/app/Sidebar";
import { SemanticSearch } from "@/components/app/SemanticSearch";
import DashboardShell from "@/components/app/DashboardShell";
import { getStreakStatus } from "@/lib/streak";
import { getTodayStartISO, getTodayDateKey } from "@/lib/accountability";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const todayStart = getTodayStartISO();
  const todayDate = getTodayDateKey();

  const [profileResult, dueResult, sessionsResult, planResult] = await Promise.all([
    supabase
      .from("users")
      .select("display_name, streak_count, streak_last_date, grace_days_remaining, daily_goal_minutes")
      .eq("id", user.id)
      .single(),
    supabase
      .from("srs_cards")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .lte("due", new Date().toISOString()),
    supabase
      .from("study_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("started_at", todayStart),
    supabase
      .from("daily_plans")
      .select("mentor_message")
      .eq("user_id", user.id)
      .eq("plan_date", todayDate)
      .maybeSingle(),
  ]);

  const profile = profileResult.data;
  const dueCount = dueResult.count ?? 0;
  const hasSessionToday = (sessionsResult.count ?? 0) > 0;
  const streakStatus = getStreakStatus({
    streak_count: profile?.streak_count ?? 0,
    streak_last_date: profile?.streak_last_date ?? null,
    grace_days_remaining: profile?.grace_days_remaining ?? 1,
  });

  const checkIn = {
    shouldShow: !hasSessionToday,
    streakCount: streakStatus.count,
    graceRemaining: streakStatus.graceRemaining,
    dueCount,
    mentorMessage: planResult.data?.mentor_message ?? null,
    dailyGoalMinutes: profile?.daily_goal_minutes ?? 60,
    displayName: profile?.display_name ?? "Learner",
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        dueCount={dueCount}
        streakCount={profile?.streak_count ?? 0}
        userEmail={user.email}
        displayName={profile?.display_name ?? undefined}
      />
      <main className="flex-1 min-h-screen overflow-y-auto">
        <div className="sticky top-0 z-40 bg-background/80 backdrop-blur-sm border-b border-border/40 px-6 py-3">
          <SemanticSearch />
        </div>
        <DashboardShell checkIn={checkIn}>{children}</DashboardShell>
      </main>
    </div>
  );
}
