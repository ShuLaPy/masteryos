import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Sidebar from "@/components/app/Sidebar";
import { SemanticSearch } from "@/components/app/SemanticSearch";

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

  // Fetch user profile + due count in parallel
  const [profileResult, dueResult] = await Promise.all([
    supabase
      .from("users")
      .select("display_name, streak_count")
      .eq("id", user.id)
      .single(),
    supabase
      .from("srs_cards")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .lte("due", new Date().toISOString()),
  ]);

  const profile = profileResult.data;
  const dueCount = dueResult.count ?? 0;

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
        {children}
      </main>
    </div>
  );
}
