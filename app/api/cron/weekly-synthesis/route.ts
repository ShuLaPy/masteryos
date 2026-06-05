import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateSynthesisForUser } from "@/app/api/weekly/synthesis/route";

/**
 * Sunday weekly synthesis cron endpoint.
 *
 * Vercel Cron example (vercel.json):
 * { "crons": [{ "path": "/api/cron/weekly-synthesis", "schedule": "0 8 * * 0" }] }
 *
 * Requires CRON_SECRET env var — pass as Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = createAdminClient();
  const { data: users, error } = await admin.from("users").select("id, email");

  if (error || !users) {
    return Response.json({ error: error?.message ?? "Failed to fetch users" }, { status: 500 });
  }

  const results: { userId: string; success: boolean }[] = [];

  for (const u of users) {
    try {
      const synthesis = await generateSynthesisForUser(u.id);
      results.push({ userId: u.id, success: !!synthesis });
    } catch {
      results.push({ userId: u.id, success: false });
    }
  }

  return Response.json({
    processed: results.length,
    succeeded: results.filter((r) => r.success).length,
    results,
  });
}
