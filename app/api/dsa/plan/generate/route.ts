import { createClient } from "@/lib/supabase/server";
import { buildDsaZones } from "@/lib/dsa-planner";
import type { Json } from "@/types/database";

/**
 * POST /api/dsa/plan/generate — build (or refresh) the DSA section of today's
 * daily plan.
 *
 * Calls buildDsaZones() to compute the three DSA zones (Recognition Drill,
 * Re-Solve Ladder, New Problem) from the user's pattern mastery, due cards, and
 * problem_bank, then merges the result into daily_plans.generated_plan.dsa
 * without overwriting the AIML zones that generateDailyPlanForUser may have
 * written earlier.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // ── 1. Build DSA zones ────────────────────────────────────────────────────
  const { data: dsaData, error: buildError } = await buildDsaZones(supabase, user.id);
  if (buildError || !dsaData) {
    return Response.json({ data: null, error: buildError }, { status: 500 });
  }

  const { plan_date, ...dsaPayload } = dsaData;

  // ── 2. Merge into existing daily_plans row (preserve AIML zones) ──────────
  const { data: existing } = await supabase
    .from("daily_plans")
    .select("generated_plan")
    .eq("user_id", user.id)
    .eq("plan_date", plan_date)
    .maybeSingle();

  const existingPlan =
    existing?.generated_plan !== null &&
    typeof existing?.generated_plan === "object" &&
    !Array.isArray(existing?.generated_plan)
      ? (existing.generated_plan as Record<string, unknown>)
      : {};

  const mergedPlan: Record<string, unknown> = { ...existingPlan, dsa: dsaPayload };

  const { error: upsertError } = await supabase.from("daily_plans").upsert(
    {
      user_id: user.id,
      plan_date,
      generated_plan: mergedPlan as unknown as Json,
    },
    { onConflict: "user_id,plan_date" },
  );

  if (upsertError) {
    return Response.json(
      { data: null, error: `Failed to save DSA plan: ${upsertError.message}` },
      { status: 500 },
    );
  }

  return Response.json({ data: { plan: dsaPayload }, error: null });
}
