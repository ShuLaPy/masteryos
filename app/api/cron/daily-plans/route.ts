import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateDailyPlanForUser } from "@/lib/planning-engine";

/**
 * Daily plan generation cron (spec Req 5 / §14).
 *
 * Regenerates the zone-partitioned daily plan for EVERY user. Runs nightly via
 * Vercel Cron (vercel.json):
 *   { "crons": [{ "path": "/api/cron/daily-plans", "schedule": "0 2 * * *" }] }
 * 02:00 UTC ≈ 07:30 IST, so plans are fresh before the typical study day starts.
 *
 * Auth: requires the CRON_SECRET env var, supplied as `Authorization: Bearer
 * <CRON_SECRET>`. The 401 response intentionally reveals nothing about the secret.
 *
 * Resilience: each user's generation is isolated — a single failure is recorded
 * and processing continues. Failures expose only the affected `userId`; the
 * underlying error is logged server-side and never returned to the caller.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // Constant message regardless of whether the secret is unset or merely wrong —
  // don't leak the secret or its existence.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = createAdminClient();
  const { data: users, error } = await admin.from("users").select("id");

  if (error || !users) {
    return Response.json(
      { error: "Failed to load users" },
      { status: 500 }
    );
  }

  let succeeded = 0;
  const failures: { userId: string }[] = [];

  for (const u of users) {
    try {
      const { error: genError } = await generateDailyPlanForUser(admin, u.id);
      if (genError) {
        // Keep the detail server-side; the response only carries the userId.
        console.error(`daily-plans cron: user ${u.id} failed: ${genError}`);
        failures.push({ userId: u.id });
        continue;
      }
      succeeded += 1;
    } catch (err) {
      // Catch per-user so one thrown error never aborts the whole run.
      console.error(`daily-plans cron: user ${u.id} threw`, err);
      failures.push({ userId: u.id });
    }
  }

  return Response.json({
    succeeded,
    failed: failures.length,
    failures,
  });
}
