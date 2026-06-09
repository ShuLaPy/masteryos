import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbCardToFSRS, getRetrievability } from "@/lib/fsrs";
import { logAttemptAndUpdateMastery } from "@/lib/dsa-planner";
import { weaknessFromMastery } from "@/lib/pattern-rating";
import { targetDistribution, actualDistribution, type MasterySnapshot } from "@/lib/dsa-coach";
import type { CanonicalPattern } from "@/lib/pattern-map";
import type { Difficulty } from "@/lib/pattern-rating";

const DIFFICULTY_WEIGHT: Record<string, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
};

const DURATION_MINUTES = 90;

interface CompetitionProblem {
  slug: string;
  title: string;
  difficulty: string;
  url: string;
  patterns: string[];
  problem_id: string | null;
}

function slugFromUrl(url: string): string {
  return url.replace(/\/$/, "").split("/").at(-1) ?? "unknown";
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// GET — competition history for the score chart
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data, error } = await supabase
    .from("weekly_competitions")
    .select("id, started_at, completed_at, score, max_score, duration_seconds, problems")
    .eq("user_id", user.id)
    .order("started_at", { ascending: false })
    .limit(20);

  if (error) {
    return Response.json({ data: null, error: error.message }, { status: 500 });
  }

  return Response.json({ data: { history: data ?? [] }, error: null });
}

export async function POST(request: NextRequest) {
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
    return Response.json({ data: null, error: "Invalid request body" }, { status: 400 });
  }

  const { action } = body as { action?: unknown };

  if (action === "start") {
    return handleStart(supabase, user.id);
  }

  if (action === "complete") {
    const { competitionId, results } = body as {
      competitionId?: unknown;
      results?: unknown;
    };
    if (typeof competitionId !== "string" || !Array.isArray(results)) {
      return Response.json(
        { data: null, error: "competitionId and results are required" },
        { status: 400 },
      );
    }
    return handleComplete(supabase, user.id, competitionId, results as Array<{ slug: string; solved: boolean }>);
  }

  return Response.json({ data: null, error: "action must be 'start' or 'complete'" }, { status: 400 });
}

// ─── Start handler ─────────────────────────────────────────────────────────────

async function handleStart(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  // Fetch attempts (split: last 7d vs older) + mastery + bank data in parallel
  const [recentRes, olderRes, masteryRes, bankRes] = await Promise.all([
    supabase
      .from("problem_attempts")
      .select("problem_id")
      .eq("user_id", userId)
      .not("problem_id", "is", null)
      .gte("created_at", sevenDaysAgo),
    supabase
      .from("problem_attempts")
      .select("problem_id")
      .eq("user_id", userId)
      .not("problem_id", "is", null)
      .lt("created_at", sevenDaysAgo),
    supabase.from("pattern_mastery").select("pattern, rating, rd").eq("user_id", userId),
    supabase.from("problem_bank").select("id, slug, title, difficulty, patterns, leetcode_url"),
  ]);

  const fetchErr = recentRes.error ?? olderRes.error ?? masteryRes.error ?? bankRes.error;
  if (fetchErr) {
    return Response.json(
      { data: null, error: `Data fetch failed: ${fetchErr.message}` },
      { status: 500 },
    );
  }

  // ── Build Pool A and Pool B id sets ──────────────────────────────────────────
  const poolAIds = [
    ...new Set(
      (recentRes.data ?? []).map((r: { problem_id: string }) => r.problem_id),
    ),
  ] as string[];

  const poolASet = new Set(poolAIds);
  const poolBIds = [
    ...new Set(
      (olderRes.data ?? [])
        .map((r: { problem_id: string }) => r.problem_id)
        .filter((id: string) => !poolASet.has(id)),
    ),
  ] as string[];

  // ── Fetch dsa_problems for both pools ────────────────────────────────────────
  const allPoolIds = [...poolAIds, ...poolBIds];

  const [dsaProblemsRes, ladderCardsRes] = await Promise.all([
    allPoolIds.length > 0
      ? supabase
          .from("dsa_problems")
          .select("id, title, difficulty, patterns, url")
          .in("id", allPoolIds)
          .eq("user_id", userId)
      : Promise.resolve({ data: [], error: null }),
    poolBIds.length > 0
      ? supabase
          .from("srs_cards")
          .select("source_id, stability, last_review, state, due, elapsed_days, scheduled_days, reps, lapses, difficulty")
          .eq("user_id", userId)
          .eq("source_type", "dsa_ladder")
          .in("source_id", poolBIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (dsaProblemsRes.error ?? ladderCardsRes.error) {
    const e = dsaProblemsRes.error ?? ladderCardsRes.error;
    return Response.json({ data: null, error: e.message }, { status: 500 });
  }

  type DsaProblemRow = {
    id: string;
    title: string;
    difficulty: string | null;
    patterns: string[] | null;
    url: string | null;
  };

  const dsaProblemMap = new Map<string, DsaProblemRow>(
    (dsaProblemsRes.data ?? []).map((p: DsaProblemRow) => [p.id, p]),
  );

  // ── Compute min retrievability per Pool B problem ─────────────────────────────
  type LadderCardRow = {
    source_id: string;
    stability: number;
    last_review: string | null;
    state: string;
    due: string;
    elapsed_days: number;
    scheduled_days: number;
    reps: number;
    lapses: number;
    difficulty: number;
  };

  const retentionByProblem = new Map<string, number>();
  for (const card of (ladderCardsRes.data ?? []) as LadderCardRow[]) {
    const fsrsCard = dbCardToFSRS({
      due: card.due,
      stability: card.stability,
      difficulty: card.difficulty,
      elapsed_days: card.elapsed_days,
      scheduled_days: card.scheduled_days,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state,
      last_review: card.last_review,
    });
    const ret = getRetrievability(fsrsCard);
    const existing = retentionByProblem.get(card.source_id);
    // Track minimum (most decayed) across all rungs
    if (existing === undefined || ret < existing) {
      retentionByProblem.set(card.source_id, ret);
    }
  }

  function toProblem(id: string): CompetitionProblem | null {
    const p = dsaProblemMap.get(id);
    if (!p || !p.url) return null;
    return {
      slug: slugFromUrl(p.url),
      title: p.title,
      difficulty: p.difficulty ?? "medium",
      url: p.url,
      patterns: (p.patterns as string[] | null) ?? [],
      problem_id: id,
    };
  }

  // ── Problem selection ─────────────────────────────────────────────────────────
  const selected: CompetitionProblem[] = [];
  const usedIds = new Set<string>();

  const poolBEmpty = poolBIds.length === 0;

  if (poolBEmpty) {
    // First week: pick 4 from Pool A (random)
    const shuffled = shuffle(poolAIds);
    for (const id of shuffled) {
      if (selected.length >= 4) break;
      const p = toProblem(id);
      if (p) { selected.push(p); usedIds.add(id); }
    }
  } else {
    // 2 from Pool A (random)
    const shuffledA = shuffle(poolAIds);
    for (const id of shuffledA) {
      if (selected.length >= 2) break;
      const p = toProblem(id);
      if (p) { selected.push(p); usedIds.add(id); }
    }

    // 2 from Pool B (lowest retention first)
    const sortedB = poolBIds
      .filter((id) => !usedIds.has(id))
      .sort((a, b) => (retentionByProblem.get(a) ?? 0) - (retentionByProblem.get(b) ?? 0));

    for (const id of sortedB) {
      if (selected.length >= 4) break;
      const p = toProblem(id);
      if (p) { selected.push(p); usedIds.add(id); }
    }
  }

  // ── Backfill from problem_bank if still under 4 ───────────────────────────────
  if (selected.length < 4) {
    const masteryByPattern = new Map<CanonicalPattern, MasterySnapshot>(
      (masteryRes.data ?? []).map((r: { pattern: string; rating: number; rd: number }) => [
        r.pattern as CanonicalPattern,
        { rating: r.rating, rd: r.rd },
      ]),
    );

    // Get weakness score per pattern
    const getWeakness = (p: string) => {
      const m = masteryByPattern.get(p as CanonicalPattern) ?? { rating: 1500, rd: 350 };
      return weaknessFromMastery(m.rating, m.rd);
    };

    // Build target distribution to find weak patterns
    const target = targetDistribution(masteryByPattern);
    const actual = actualDistribution([], 14, Date.now());

    // Score bank problems by weakness relevance
    const usedSlugs = new Set(selected.map((p) => p.slug));
    const neededCount = 4 - selected.length;

    // Mix difficulty: cycle easy → medium → hard for variety
    const byDiff: Record<string, Array<{ slug: string; title: string; difficulty: string; url: string; patterns: string[]; score: number }>> = {
      easy: [],
      medium: [],
      hard: [],
    };

    for (const b of (bankRes.data ?? []) as Array<{ slug: string; title: string; difficulty: string; leetcode_url: string; patterns: string[] }>) {
      if (usedSlugs.has(b.slug)) continue;
      const patterns = (b.patterns as string[] | null) ?? [];
      const weakness = patterns.length > 0 ? Math.max(...patterns.map(getWeakness)) : 0.5;
      const targetScore = patterns.reduce((s, p) => s + (target.get(p as CanonicalPattern) ?? 0), 0);
      const actualScore = patterns.reduce((s, p) => s + (actual.get(p) ?? 0), 0);
      const score = weakness * (1 + targetScore - actualScore);
      const d = b.difficulty in byDiff ? b.difficulty : "medium";
      byDiff[d].push({ slug: b.slug, title: b.title, difficulty: b.difficulty, url: b.leetcode_url, patterns, score });
    }

    for (const d of ["easy", "medium", "hard"] as const) {
      byDiff[d].sort((a, b) => b.score - a.score);
    }

    // Round-robin from difficulties
    const diffs = ["easy", "medium", "hard"] as const;
    const indices = { easy: 0, medium: 0, hard: 0 };
    let picked = 0;
    while (picked < neededCount) {
      let any = false;
      for (const d of diffs) {
        if (picked >= neededCount) break;
        if (indices[d] < byDiff[d].length) {
          const b = byDiff[d][indices[d]++];
          selected.push({
            slug: b.slug,
            title: b.title,
            difficulty: b.difficulty,
            url: b.url,
            patterns: b.patterns,
            problem_id: null,
          });
          picked++;
          any = true;
        }
      }
      if (!any) break;
    }
  }

  if (selected.length === 0) {
    return Response.json(
      { data: null, error: "No problems available for competition" },
      { status: 422 },
    );
  }

  // ── Compute maxScore and create DB row ────────────────────────────────────────
  const maxScore = selected.reduce(
    (s, p) => s + (DIFFICULTY_WEIGHT[p.difficulty] ?? 2),
    0,
  );

  const slugs = selected.map((p) => p.slug);

  const { data: row, error: insertErr } = await supabase
    .from("weekly_competitions")
    .insert({
      user_id: userId,
      problem_slugs: slugs,
      problems: selected,
      started_at: new Date().toISOString(),
      max_score: maxScore,
    })
    .select("id")
    .single();

  if (insertErr || !row) {
    return Response.json(
      { data: null, error: insertErr?.message ?? "Failed to create competition" },
      { status: 500 },
    );
  }

  return Response.json({
    data: {
      competitionId: row.id,
      problems: selected.map(({ slug, title, difficulty, url }) => ({
        slug,
        title,
        difficulty,
        url,
      })),
      maxScore,
      durationMinutes: DURATION_MINUTES,
    },
    error: null,
  });
}

// ─── Complete handler ───────────────────────────────────────────────────────────

async function handleComplete(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  competitionId: string,
  results: Array<{ slug: string; solved: boolean }>,
) {
  // Fetch the competition row
  const { data: comp, error: fetchErr } = await supabase
    .from("weekly_competitions")
    .select("id, problems, max_score, started_at, completed_at")
    .eq("id", competitionId)
    .eq("user_id", userId)
    .single();

  if (fetchErr || !comp) {
    return Response.json(
      { data: null, error: "Competition not found" },
      { status: 404 },
    );
  }

  if (comp.completed_at) {
    return Response.json(
      { data: null, error: "Competition already completed" },
      { status: 409 },
    );
  }

  const problems = (comp.problems ?? []) as CompetitionProblem[];
  const problemBySlug = new Map(problems.map((p) => [p.slug, p]));

  const resultMap = new Map(results.map((r) => [r.slug, r.solved]));

  // Compute score
  let score = 0;
  for (const r of results) {
    if (!r.solved) continue;
    const p = problemBySlug.get(r.slug);
    if (p) score += DIFFICULTY_WEIGHT[p.difficulty] ?? 2;
  }

  const now = new Date().toISOString();
  const startedAt = new Date(comp.started_at as string).getTime();
  const durationSeconds = Math.round((Date.now() - startedAt) / 1000);

  // Update competition row
  const { error: updateErr } = await supabase
    .from("weekly_competitions")
    .update({
      completed_at: now,
      score,
      duration_seconds: durationSeconds,
    })
    .eq("id", competitionId)
    .eq("user_id", userId);

  if (updateErr) {
    return Response.json({ data: null, error: updateErr.message }, { status: 500 });
  }

  // Log problem_attempts for each solved problem
  const solvedProblems = problems.filter((p) => resultMap.get(p.slug) === true);
  const logErrors: string[] = [];

  await Promise.all(
    solvedProblems.map(async (p) => {
      const { error } = await logAttemptAndUpdateMastery(
        supabase,
        userId,
        p.problem_id,
        p.patterns,
        (p.difficulty as Difficulty) || "medium",
        "solved_effort",
        {},
      );
      if (error) logErrors.push(error);
    }),
  );

  return Response.json({
    data: {
      score,
      maxScore: comp.max_score as number,
      percentile: null,
      logErrors: logErrors.length > 0 ? logErrors : undefined,
    },
    error: null,
  });
}
