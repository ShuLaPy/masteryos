import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateRecommendations } from "@/lib/paper-recommender";

// Two sequential LLM calls + several arXiv fetches — give the route headroom.
export const maxDuration = 60;

const STATUS_VALUES = ["suggested", "saved", "read", "dismissed"] as const;

/**
 * GET /api/papers/recommend
 *
 * Returns the user's persisted paper recommendations (reading list).
 * Optional ?status= filter (suggested | saved | read | dismissed).
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const statusParam = new URL(request.url).searchParams.get("status");

  let query = supabase
    .from("paper_recommendations")
    .select("*")
    .eq("user_id", user.id)
    .order("reading_order", { ascending: true, nullsFirst: false })
    .order("relevance_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (statusParam && (STATUS_VALUES as readonly string[]).includes(statusParam)) {
    query = query.eq("status", statusParam);
  }

  const { data, error } = await query;
  if (error) {
    return Response.json({ data: null, error: error.message }, { status: 500 });
  }
  return Response.json({ data: { recommendations: data ?? [] }, error: null });
}

/**
 * POST /api/papers/recommend
 *
 * Runs the arXiv-grounded recommendation pipeline and persists the results,
 * preserving the reading-list status of any paper already in the list.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data, error } = await generateRecommendations(supabase, user.id);

  if (error || !data) {
    return Response.json(
      { data: null, error: error ?? "Recommendation failed" },
      { status: 500 }
    );
  }

  if (data.status === "insufficient") {
    return Response.json({
      data: {
        insufficient: true,
        learnedCount: data.learnedCount,
        message:
          "Log at least 3 concepts (seeded or learned) to get paper recommendations matched to your level.",
      },
      error: null,
    });
  }

  return Response.json({
    data: { recommendations: data.recommendations },
    error: null,
  });
}
