import { createClient } from "@/lib/supabase/server";
import { generateDailyPlanForUser } from "@/lib/planning-engine";

/**
 * POST /api/plans/generate — on-demand zone-partitioned daily plan (spec §14 step 4).
 *
 * Thin wrapper: authenticate the caller, then delegate all zone logic — priority
 * scoring (§4), capacity fill (§5), cold-start remediation (§6) and persistence —
 * to {@link generateDailyPlanForUser} in lib/planning-engine. The same function
 * powers the all-user cron at /api/cron/daily-plans.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data, error } = await generateDailyPlanForUser(supabase, user.id);
  if (error) {
    return Response.json({ data: null, error }, { status: 500 });
  }

  return Response.json({ data, error: null });
}
