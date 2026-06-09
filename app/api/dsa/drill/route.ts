import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete } from "@/lib/ai-router";
import { weaknessFromMastery } from "@/lib/pattern-rating";
import { type CanonicalPattern } from "@/lib/pattern-map";
import { fetchLeetCodeProblem, extractLCSlug } from "@/lib/leetcode";

// GET /api/dsa/drill — pick a problem biased toward weak patterns
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const cutoff7d = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [masteryRes, recentDrillsRes, bankRes] = await Promise.all([
    supabase
      .from("pattern_mastery")
      .select("pattern, rating, rd")
      .eq("user_id", user.id),
    supabase
      .from("pattern_drill_attempts")
      .select("problem_slug")
      .eq("user_id", user.id)
      .gte("created_at", cutoff7d),
    supabase.from("problem_bank").select("slug, title, difficulty, patterns, leetcode_url"),
  ]);

  const fetchErr = masteryRes.error ?? recentDrillsRes.error ?? bankRes.error;
  if (fetchErr)
    return Response.json(
      { data: null, error: fetchErr.message },
      { status: 500 },
    );

  const masteryByPattern = new Map<CanonicalPattern, { rating: number; rd: number }>(
    (masteryRes.data ?? []).map((r) => [
      r.pattern as CanonicalPattern,
      { rating: r.rating, rd: r.rd },
    ]),
  );

  const recentlyDrilled = new Set(
    (recentDrillsRes.data ?? []).map((d) => d.problem_slug),
  );

  let pool = (bankRes.data ?? []).filter((b) => !recentlyDrilled.has(b.slug));
  // Fall back to full bank if everything was recently drilled
  if (pool.length === 0) pool = bankRes.data ?? [];
  if (pool.length === 0)
    return Response.json(
      { data: null, error: "No problems in bank" },
      { status: 404 },
    );

  // Score each problem by weakness of its primary pattern
  const scored = pool.map((b) => {
    const patterns = (b.patterns as string[] | null) ?? [];
    const primary = patterns[0] as CanonicalPattern | undefined;
    const mastery = primary
      ? (masteryByPattern.get(primary) ?? { rating: 1500, rd: 350 })
      : { rating: 1500, rd: 350 };
    const weakness = primary
      ? weaknessFromMastery(mastery.rating, mastery.rd)
      : 0.5;
    return { ...b, weakness };
  });

  // Weighted random selection — problems with high weakness surface more often
  const totalWeight = scored.reduce((s, b) => s + b.weakness, 0);
  let rand = Math.random() * (totalWeight || 1);
  let picked = scored[0];
  for (const b of scored) {
    rand -= b.weakness;
    if (rand <= 0) {
      picked = b;
      break;
    }
  }

  // Fetch problem content from LeetCode (best-effort — null if rate-limited/offline)
  const lcSlug = extractLCSlug(picked.leetcode_url) ?? picked.slug;
  const lcProblem = await fetchLeetCodeProblem(lcSlug);

  return Response.json({
    data: {
      slug: picked.slug,
      title: picked.title,
      difficulty: picked.difficulty,
      content: lcProblem?.content ?? null,
    },
    error: null,
  });
}

// POST /api/dsa/drill — submit a pattern guess
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

  const { slug, guessedPatterns } = body as {
    slug: string;
    guessedPatterns: string[];
  };

  if (
    typeof slug !== "string" ||
    !slug ||
    !Array.isArray(guessedPatterns)
  ) {
    return Response.json(
      { data: null, error: "Missing required fields" },
      { status: 400 },
    );
  }

  // Load the problem's real patterns from problem_bank
  const { data: problem, error: bankErr } = await supabase
    .from("problem_bank")
    .select("title, patterns")
    .eq("slug", slug)
    .single();

  if (bankErr || !problem)
    return Response.json({ data: null, error: "Problem not found" }, { status: 404 });

  const realPatterns = (problem.patterns as string[] | null) ?? [];
  const primaryPattern = realPatterns[0] ?? null;

  // Correct = the guessed set includes the primary pattern
  const isCorrect =
    primaryPattern !== null && guessedPatterns.includes(primaryPattern);

  // Log the attempt
  const { error: insertErr } = await supabase
    .from("pattern_drill_attempts")
    .insert({
      user_id: user.id,
      problem_slug: slug,
      guessed_patterns: guessedPatterns,
      correct_patterns: realPatterns,
      is_correct: isCorrect,
    });

  if (insertErr)
    return Response.json(
      { data: null, error: insertErr.message },
      { status: 500 },
    );

  // LLM explanation
  const { data: aiData } = await complete({
    task: "problem_selection",
    systemPrompt:
      "You are an expert DSA coach. Explain pattern classification in 3-4 sentences. Be encouraging and concrete. Plain text only, no markdown.",
    messages: [
      {
        role: "user",
        content:
          `The student saw "${problem.title}" and guessed it uses: ` +
          `${guessedPatterns.join(", ") || "(none)"}.\n` +
          `The actual patterns are: ${realPatterns.join(", ") || "(unknown)"}.\n` +
          `In 3-4 sentences, explain whether their classification was right, partially right, or wrong, ` +
          `and WHY — what signal in the problem points to the correct pattern. Be encouraging and concrete.`,
      },
    ],
  });

  const explanation =
    aiData?.content ??
    "Keep practicing — pattern recognition improves with every problem you review.";

  return Response.json({
    data: { isCorrect, realPatterns, explanation },
    error: null,
  });
}
