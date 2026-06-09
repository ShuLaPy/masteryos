import { createClient } from "@/lib/supabase/server";
import { complete } from "@/lib/ai-router";
import { weaknessFromMastery } from "@/lib/pattern-rating";
import { type CanonicalPattern } from "@/lib/pattern-map";

const DIFFICULTY_MINUTES: Record<string, number> = {
  easy: 20,
  medium: 35,
  hard: 50,
};

const SOLVED_WELL_SCORE = 0.5;
const SOLVED_WELL_DAYS = 30;

// GET — return sorted distinct company tags from the problem bank
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data, error } = await supabase
    .from("problem_bank")
    .select("company_tags")
    .not("company_tags", "is", null);

  if (error) {
    return Response.json(
      { data: null, error: `Failed to load companies: ${error.message}` },
      { status: 500 },
    );
  }

  const companies = [
    ...new Set(
      (data ?? [])
        .flatMap((r) => (r.company_tags as string[] | null) ?? [])
        .filter(Boolean),
    ),
  ].sort();

  return Response.json({ data: { companies }, error: null });
}

// POST — build a company-targeted practice session
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ data: null, error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return Response.json(
      { data: null, error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { company, timeBudgetMinutes } = body as {
    company?: unknown;
    timeBudgetMinutes?: unknown;
  };

  if (typeof company !== "string" || !company.trim()) {
    return Response.json(
      { data: null, error: "company is required" },
      { status: 400 },
    );
  }
  if (
    typeof timeBudgetMinutes !== "number" ||
    timeBudgetMinutes < 5 ||
    timeBudgetMinutes > 480
  ) {
    return Response.json(
      { data: null, error: "timeBudgetMinutes must be between 5 and 480" },
      { status: 400 },
    );
  }

  const companyName = company.trim();
  const cutoffSolved = new Date(
    Date.now() - SOLVED_WELL_DAYS * 86_400_000,
  ).toISOString();

  const [bankRes, masteryRes, attemptsRes] = await Promise.all([
    supabase
      .from("problem_bank")
      .select("id, slug, title, difficulty, patterns, leetcode_url, company_tags")
      .contains("company_tags", [companyName]),
    supabase
      .from("pattern_mastery")
      .select("pattern, rating, rd")
      .eq("user_id", user.id),
    supabase
      .from("problem_attempts")
      .select("problem_id, outcome_score")
      .eq("user_id", user.id)
      .not("problem_id", "is", null)
      .gte("created_at", cutoffSolved)
      .gte("outcome_score", SOLVED_WELL_SCORE),
  ]);

  const fetchErr = bankRes.error ?? masteryRes.error ?? attemptsRes.error;
  if (fetchErr) {
    return Response.json(
      { data: null, error: `Data fetch failed: ${fetchErr.message}` },
      { status: 500 },
    );
  }

  if (!bankRes.data || bankRes.data.length === 0) {
    return Response.json({
      data: { company: companyName, session: [], totalEstimatedMinutes: 0 },
      error: null,
    });
  }

  const masteryByPattern = new Map<CanonicalPattern, { rating: number; rd: number }>(
    (masteryRes.data ?? []).map((r) => [
      r.pattern as CanonicalPattern,
      { rating: r.rating, rd: r.rd },
    ]),
  );

  const getWeakness = (pattern: string): number => {
    const m = masteryByPattern.get(pattern as CanonicalPattern) ?? {
      rating: 1500,
      rd: 350,
    };
    return weaknessFromMastery(m.rating, m.rd);
  };

  const solvedWellIds = new Set<string>(
    (attemptsRes.data ?? [])
      .map((r) => r.problem_id)
      .filter((id): id is string => typeof id === "string"),
  );

  type Candidate = {
    id: string;
    slug: string;
    title: string;
    difficulty: string;
    patterns: string[];
    leetcode_url: string;
    weakness: number;
    estimatedMinutes: number;
  };

  const candidates: Candidate[] = (bankRes.data ?? [])
    .filter((p) => !solvedWellIds.has(p.id))
    .map((p) => {
      const patterns = (p.patterns as string[] | null) ?? [];
      const weakness =
        patterns.length > 0 ? Math.max(...patterns.map(getWeakness)) : 0.5;
      return {
        id: p.id,
        slug: p.slug,
        title: p.title,
        difficulty: p.difficulty,
        patterns,
        leetcode_url: p.leetcode_url,
        weakness,
        estimatedMinutes: DIFFICULTY_MINUTES[p.difficulty] ?? 35,
      };
    });

  if (candidates.length === 0) {
    return Response.json({
      data: { company: companyName, session: [], totalEstimatedMinutes: 0 },
      error: null,
    });
  }

  // Group by difficulty, sort each group by weakness desc, then round-robin to mix
  const byDiff: Record<string, Candidate[]> = { easy: [], medium: [], hard: [] };
  for (const c of candidates) {
    const d = c.difficulty in byDiff ? c.difficulty : "medium";
    byDiff[d].push(c);
  }
  for (const d of ["easy", "medium", "hard"] as const) {
    byDiff[d].sort((a, b) => b.weakness - a.weakness);
  }

  // Interleave: one easy, two medium, one hard per cycle → natural session warmup
  const interleaved: Candidate[] = [];
  const eIdx = { easy: 0, medium: 0, hard: 0 };
  const maxIter = Math.max(
    byDiff.easy.length,
    Math.ceil(byDiff.medium.length / 2),
    byDiff.hard.length,
  );
  for (let i = 0; i < maxIter; i++) {
    if (eIdx.easy < byDiff.easy.length) interleaved.push(byDiff.easy[eIdx.easy++]);
    if (eIdx.medium < byDiff.medium.length) interleaved.push(byDiff.medium[eIdx.medium++]);
    if (eIdx.medium < byDiff.medium.length) interleaved.push(byDiff.medium[eIdx.medium++]);
    if (eIdx.hard < byDiff.hard.length) interleaved.push(byDiff.hard[eIdx.hard++]);
  }

  const shortlist: Candidate[] = [];
  let totalMinutes = 0;
  for (const c of interleaved) {
    if (totalMinutes + c.estimatedMinutes > timeBudgetMinutes) continue;
    shortlist.push(c);
    totalMinutes += c.estimatedMinutes;
  }

  // Budget too small to fit any problem — include the weakest single problem anyway
  if (shortlist.length === 0) {
    const weakest = [...candidates].sort((a, b) => b.weakness - a.weakness)[0];
    shortlist.push(weakest);
    totalMinutes = weakest.estimatedMinutes;
  }

  // Build weak-pattern context for the LLM
  const patternSet = new Set(shortlist.flatMap((c) => c.patterns));
  const weakPatternContext = [...patternSet]
    .map((p) => {
      const m = masteryByPattern.get(p as CanonicalPattern) ?? {
        rating: 1500,
        rd: 350,
      };
      return `${p}: weakness=${weaknessFromMastery(m.rating, m.rd).toFixed(2)}, rating=${Math.round(m.rating)}`;
    })
    .join("\n");

  const candidateLines = shortlist
    .map(
      (c, i) =>
        `${i + 1}. slug="${c.slug}" | "${c.title}" | difficulty=${c.difficulty} | patterns=[${c.patterns.join(",")}] | estimatedMinutes=${c.estimatedMinutes}`,
    )
    .join("\n");

  const SYSTEM_PROMPT = `You are a DSA interview-prep coach specializing in ${companyName} interviews. Order the shortlist into a productive practice session and write a one-line rationale for each problem.

STRICT RULES:
- Only return slugs that appear verbatim in the shortlist. Never invent or modify slugs.
- One rationale per problem, ≤ 20 words, referencing the learner's weakness or ${companyName}'s interview focus.
- Return valid JSON only: { "ranked": [{ "slug": string, "rationale": string }] }
- Return ALL problems from the shortlist, ordered logically (e.g. warm-up → harder).`;

  const USER_PROMPT = `Learner's pattern weakness context:
${weakPatternContext}

Problems shortlist for ${companyName} session (time budget: ${timeBudgetMinutes} min):
${candidateLines}

Order into a productive session and write one rationale per problem.`;

  const { data: completionData, error: llmError } = await complete({
    task: "problem_selection",
    systemPrompt:
      SYSTEM_PROMPT +
      "\n\nIMPORTANT: Respond with ONLY valid JSON, no markdown, no code blocks.",
    messages: [{ role: "user", content: USER_PROMPT }],
  });

  if (llmError || !completionData) {
    // Return shortlist without rationale on LLM failure
    return Response.json({
      data: {
        company: companyName,
        session: shortlist.map((c) => ({
          slug: c.slug,
          title: c.title,
          difficulty: c.difficulty,
          url: c.leetcode_url,
          patterns: c.patterns,
          rationale: "",
        })),
        totalEstimatedMinutes: totalMinutes,
      },
      error: null,
    });
  }

  interface LLMRanked {
    ranked: Array<{ slug: string; rationale: string }>;
  }

  let llmResult: LLMRanked | null = null;
  try {
    llmResult = JSON.parse(completionData.content) as LLMRanked;
  } catch {
    // fall through — return unranked shortlist
  }

  const shortlistBySlug = new Map(shortlist.map((c) => [c.slug, c]));

  const rankedItems = llmResult?.ranked ?? shortlist.map((c) => ({ slug: c.slug, rationale: "" }));
  const session = rankedItems
    .filter(
      (r) =>
        r !== null &&
        typeof r === "object" &&
        typeof r.slug === "string" &&
        shortlistBySlug.has(r.slug),
    )
    .map((r) => {
      const c = shortlistBySlug.get(r.slug)!;
      return {
        slug: c.slug,
        title: c.title,
        difficulty: c.difficulty,
        url: c.leetcode_url,
        patterns: c.patterns,
        rationale: (r.rationale ?? "").trim(),
      };
    });

  // If LLM dropped some slugs, append remaining in original order
  const ranked = new Set(session.map((s) => s.slug));
  for (const c of shortlist) {
    if (!ranked.has(c.slug)) {
      session.push({
        slug: c.slug,
        title: c.title,
        difficulty: c.difficulty,
        url: c.leetcode_url,
        patterns: c.patterns,
        rationale: "",
      });
    }
  }

  return Response.json({
    data: { company: companyName, session, totalEstimatedMinutes: totalMinutes },
    error: null,
  });
}
