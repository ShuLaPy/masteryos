import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import { computeLectureIntelligence } from "@/lib/mentor-context";
import { computeLectureLifecycles, type PrepIntel } from "@/lib/lecture-lifecycle";

/** Validate an IANA timezone via Intl; fall back to UTC (spec §9.4). */
function resolveTimeZone(tz: unknown): string {
  if (typeof tz === "string" && tz.length > 0) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    } catch {
      // fall through
    }
  }
  return "UTC";
}

// GET /api/lectures/lifecycle — lifecycle cards for the user's active lectures.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: profile } = await supabase
    .from("users")
    .select("settings")
    .eq("id", user.id)
    .single();
  const timeZone = resolveTimeZone(
    (profile?.settings as { timezone?: unknown } | null)?.timezone
  );
  const today = formatInTimeZone(new Date(), timeZone, "yyyy-MM-dd");

  // Prep readiness/gap numbers reuse the mentor's intel so they match the
  // Schedule readiness widget exactly. Best-effort: lifecycle still renders
  // (with null readiness) if intel fails.
  const prepIntel = new Map<string, PrepIntel>();
  const { data: intel } = await computeLectureIntelligence(supabase, user.id);
  for (const lec of intel?.upcoming ?? []) {
    prepIntel.set(lec.id, {
      readinessPct: Math.round(lec.readinessScore * 100),
      gapCount: lec.prereqs.filter((p) => p.status !== "strong").length,
    });
  }

  const { data: lifecycles, error } = await computeLectureLifecycles(
    supabase,
    user.id,
    prepIntel,
    today
  );

  if (error) {
    return Response.json({ data: null, error }, { status: 500 });
  }

  return Response.json({ data: { lifecycles }, error: null });
}
