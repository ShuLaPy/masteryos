import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ data: null, error: "Invalid JSON" }, { status: 400 });
  }

  const { problem_slug, guessed_patterns, correct_patterns } = body as {
    problem_slug: string;
    guessed_patterns: string[];
    correct_patterns: string[];
  };

  if (
    typeof problem_slug !== "string" ||
    !problem_slug ||
    !Array.isArray(guessed_patterns) ||
    !Array.isArray(correct_patterns)
  ) {
    return Response.json({ data: null, error: "Missing required fields" }, { status: 400 });
  }

  const correctSet = new Set(correct_patterns);
  const is_correct =
    guessed_patterns.length === correct_patterns.length &&
    guessed_patterns.every((p) => correctSet.has(p));

  const { error } = await supabase.from("pattern_drill_attempts").insert({
    user_id: user.id,
    problem_slug,
    guessed_patterns,
    correct_patterns,
    is_correct,
  });

  if (error)
    return Response.json({ data: null, error: error.message }, { status: 500 });

  return Response.json({ data: { is_correct }, error: null });
}
