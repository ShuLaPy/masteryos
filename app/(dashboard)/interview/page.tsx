import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getWeekStartDate } from "@/lib/accountability";
import { toSlotMeta, type InterviewSlot } from "@/lib/interview-engine";
import InterviewClient, { type ExistingSession } from "@/components/app/InterviewClient";

export const metadata = { title: "Mock Interview — MasteryOS" };

export default async function InterviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: session } = await supabase
    .from("interview_sessions")
    .select("id, status, question_plan, grades, transcript, current_slot, overall_score")
    .eq("user_id", user.id)
    .eq("week_start_date", getWeekStartDate())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const existing: ExistingSession | null = session
    ? {
        sessionId: session.id,
        status: session.status as ExistingSession["status"],
        slotsMeta: toSlotMeta((session.question_plan as unknown as InterviewSlot[]) ?? []),
        transcript: (session.transcript as unknown as { role: "user" | "assistant"; content: string }[]) ?? [],
        currentSlot: session.current_slot ?? 0,
        overallScore: session.overall_score,
      }
    : null;

  return <InterviewClient existingSession={existing} />;
}
