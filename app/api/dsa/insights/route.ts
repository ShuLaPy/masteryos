import { createClient } from "@/lib/supabase/server";
import { complete } from "@/lib/ai-router";
import {
  targetDistribution,
  actualDistribution,
  computeDrift,
  balanceScore,
  type MasterySnapshot,
} from "@/lib/dsa-coach";
import { zpdDifficulty } from "@/lib/dsa-planner";
import { weaknessFromMastery } from "@/lib/pattern-rating";
import { CANONICAL_PATTERNS, type CanonicalPattern } from "@/lib/pattern-map";

const DEFAULT_RATING = 1500;
const DEFAULT_RD = 350;

function isoWeekMonday(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diff);
  return monday.toISOString().slice(0, 10);
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const cutoff14d = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const cutoff12w = new Date(Date.now() - 84 * 86_400_000).toISOString();

  const [masteryRes, attemptsCoachRes, attemptsTrajectoryRes, bankRes, solvedRes, allAttemptsRes] =
    await Promise.all([
      supabase
        .from("pattern_mastery")
        .select("pattern, rating, rd, attempts")
        .eq("user_id", user.id),
      supabase
        .from("problem_attempts")
        .select("patterns, created_at, outcome_score")
        .eq("user_id", user.id)
        .gte("created_at", cutoff14d),
      supabase
        .from("problem_attempts")
        .select("outcome_score, created_at")
        .eq("user_id", user.id)
        .gte("created_at", cutoff12w)
        .order("created_at", { ascending: true }),
      supabase
        .from("problem_bank")
        .select("id, slug, title, difficulty, patterns, leetcode_url"),
      supabase.from("dsa_problems").select("url").eq("user_id", user.id),
      supabase
        .from("problem_attempts")
        .select("patterns, difficulty, outcome_score, time_seconds, pattern_identified, created_at")
        .eq("user_id", user.id),
    ]);

  const fetchErr =
    masteryRes.error ??
    attemptsCoachRes.error ??
    attemptsTrajectoryRes.error ??
    bankRes.error ??
    solvedRes.error ??
    allAttemptsRes.error;

  if (fetchErr) {
    return Response.json(
      { data: null, error: `Failed to load data: ${fetchErr.message}` },
      { status: 500 },
    );
  }

  // ── 1. Per-pattern mastery ─────────────────────────────────────────────────
  const masteryByPattern = new Map<CanonicalPattern, MasterySnapshot>(
    (masteryRes.data ?? []).map((r) => [
      r.pattern as CanonicalPattern,
      { rating: r.rating, rd: r.rd },
    ]),
  );
  const attemptsCountByPattern = new Map<string, number>(
    (masteryRes.data ?? []).map((r) => [r.pattern, r.attempts]),
  );

  const patterns = CANONICAL_PATTERNS.map((p) => {
    const m = masteryByPattern.get(p) ?? { rating: DEFAULT_RATING, rd: DEFAULT_RD };
    return {
      pattern: p,
      rating: m.rating,
      rd: m.rd,
      attempts: attemptsCountByPattern.get(p) ?? 0,
      weakness: weaknessFromMastery(m.rating, m.rd),
      zpd_difficulty: zpdDifficulty(m.rating),
    };
  });

  // ── 2. Trajectory (weekly avg outcome score, last 12 weeks) ───────────────
  const weekBuckets = new Map<string, { sum: number; count: number }>();
  for (const a of attemptsTrajectoryRes.data ?? []) {
    const week = isoWeekMonday(a.created_at);
    const b = weekBuckets.get(week) ?? { sum: 0, count: 0 };
    weekBuckets.set(week, { sum: b.sum + a.outcome_score, count: b.count + 1 });
  }
  const trajectory = [...weekBuckets.entries()]
    .map(([week, { sum, count }]) => ({
      week,
      avg_score: Math.round((sum / count) * 100) / 100,
      count,
    }))
    .sort((a, b) => a.week.localeCompare(b.week));

  // ── 3. Coach drift ─────────────────────────────────────────────────────────
  const target = targetDistribution(masteryByPattern);
  const actual = actualDistribution(attemptsCoachRes.data ?? [], 14, Date.now());
  const { neglected, overPracticed } = computeDrift(target, actual);
  const coach = {
    neglected,
    over_practiced: overPracticed,
    balance_score: Math.round(balanceScore(target, actual) * 100) / 100,
  };

  // ── 4. ZPD suggestions — one bank problem per neglected/weak pattern ───────
  const solvedUrls = new Set<string>(
    (solvedRes.data ?? [])
      .map((r) => r.url)
      .filter((u): u is string => typeof u === "string"),
  );

  const topPatterns: CanonicalPattern[] =
    neglected.length > 0
      ? (neglected.slice(0, 3) as CanonicalPattern[])
      : CANONICAL_PATTERNS.slice()
          .sort((a, b) => {
            const wa = weaknessFromMastery(
              masteryByPattern.get(a)?.rating ?? DEFAULT_RATING,
              masteryByPattern.get(a)?.rd ?? DEFAULT_RD,
            );
            const wb = weaknessFromMastery(
              masteryByPattern.get(b)?.rating ?? DEFAULT_RATING,
              masteryByPattern.get(b)?.rd ?? DEFAULT_RD,
            );
            return wb - wa;
          })
          .slice(0, 3);

  interface Suggestion {
    slug: string;
    title: string;
    difficulty: string;
    url: string;
    patterns: string[];
    target_pattern: string;
  }

  const suggestions: Suggestion[] = [];
  const usedSlugs = new Set<string>();
  for (const targetPattern of topPatterns) {
    const zpd = zpdDifficulty(
      masteryByPattern.get(targetPattern)?.rating ?? DEFAULT_RATING,
    );
    const match = (bankRes.data ?? []).find(
      (b) =>
        !usedSlugs.has(b.slug) &&
        !(b.leetcode_url && solvedUrls.has(b.leetcode_url)) &&
        b.difficulty === zpd &&
        ((b.patterns as string[]) ?? []).includes(targetPattern),
    );
    if (match) {
      usedSlugs.add(match.slug);
      suggestions.push({
        slug: match.slug,
        title: match.title,
        difficulty: match.difficulty,
        url: match.leetcode_url,
        patterns: (match.patterns as string[]) ?? [],
        target_pattern: targetPattern,
      });
    }
  }

  // ── 5. AI brief — narrative only, LLM never computes numbers ─────────────
  const trajectoryDir =
    trajectory.length >= 2
      ? trajectory[trajectory.length - 1].avg_score >
        trajectory[trajectory.length - 2].avg_score
        ? "improving"
        : "declining"
      : "stable (not enough data)";

  const topWeak = patterns
    .filter((p) => p.attempts > 0)
    .sort((a, b) => b.weakness - a.weakness)
    .slice(0, 3)
    .map((p) => `${p.pattern}(rating=${Math.round(p.rating)})`);

  const briefContext = [
    `Balance score: ${coach.balance_score} (1.0 = perfect).`,
    `Neglected: ${coach.neglected.length > 0 ? coach.neglected.join(", ") : "none"}.`,
    `Over-practiced: ${coach.over_practiced.length > 0 ? coach.over_practiced.join(", ") : "none"}.`,
    `Weakest practiced patterns: ${topWeak.length > 0 ? topWeak.join(", ") : "none yet"}.`,
    `Recent 2-week trend: ${trajectoryDir}.`,
    `Patterns attempted so far: ${patterns.filter((p) => p.attempts > 0).length} of 25.`,
  ].join(" ");

  const { data: briefData } = await complete({
    task: "coaching_synthesis",
    systemPrompt:
      "You are a concise DSA coach. Write a 3-sentence daily brief for a learner using only the stats given. " +
      "Sentence 1: portfolio balance assessment. " +
      "Sentence 2: which 1-2 specific patterns to focus on today and why. " +
      "Sentence 3: short motivational nudge referencing their trajectory. " +
      "Under 70 words total. Plain text, no markdown.",
    messages: [
      {
        role: "user",
        content: `Stats:\n${briefContext}\n\nWrite the 3-sentence brief.`,
      },
    ],
  });

  const brief =
    briefData?.content ??
    "Keep grinding — consistent practice across all 25 patterns builds lasting mastery.";

  // ── 6. Weekly summary metrics (§14) ───────────────────────────────────────
  const MASTERY_RATING_THRESHOLD = 1650;
  const MASTERY_RD_THRESHOLD = 200;

  const avgRating = Math.round(
    patterns.reduce((s, p) => s + p.rating, 0) / patterns.length,
  );
  const breadth = patterns.filter(
    (p) => p.rating >= MASTERY_RATING_THRESHOLD && p.rd <= MASTERY_RD_THRESHOLD,
  ).length;

  const DIFFICULTY_ORDER = { easy: 1, medium: 2, hard: 3 } as const;
  type DifficultyKey = keyof typeof DIFFICULTY_ORDER;

  const ceilingByPattern = new Map<string, DifficultyKey>();
  for (const a of allAttemptsRes.data ?? []) {
    if (a.outcome_score >= 0.5 && a.difficulty in DIFFICULTY_ORDER) {
      const diff = a.difficulty as DifficultyKey;
      const rank = DIFFICULTY_ORDER[diff];
      for (const pat of a.patterns as string[]) {
        const cur = ceilingByPattern.get(pat);
        if (rank > (cur ? DIFFICULTY_ORDER[cur] : 0)) ceilingByPattern.set(pat, diff);
      }
    }
  }
  const difficultyCeiling = { easy: 0, medium: 0, hard: 0 };
  for (const v of ceilingByPattern.values()) difficultyCeiling[v]++;

  const cutoff7d = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const recentTimes = (allAttemptsRes.data ?? [])
    .filter((a) => a.created_at >= cutoff7d && a.time_seconds != null)
    .map((a) => a.time_seconds as number)
    .sort((a, b) => a - b);
  const medianTimeToInsightSeconds =
    recentTimes.length > 0 ? recentTimes[Math.floor(recentTimes.length / 2)] : null;

  const cutoff30d = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const recent30 = (allAttemptsRes.data ?? []).filter((a) => a.created_at >= cutoff30d);
  const withId = recent30.filter((a) => a.pattern_identified != null);
  const correctId = withId.filter((a) =>
    (a.patterns as string[]).includes(a.pattern_identified as string),
  );
  const recognitionAccuracyPct =
    withId.length > 0 ? Math.round((correctId.length / withId.length) * 100) : null;

  const weeklySummary = {
    avg_rating: avgRating,
    breadth,
    difficulty_ceiling: difficultyCeiling,
    median_time_to_insight_seconds: medianTimeToInsightSeconds,
    balance_score: coach.balance_score,
    recognition_accuracy_pct: recognitionAccuracyPct,
  };

  return Response.json({
    data: { patterns, trajectory, coach, suggestions, brief, weekly_summary: weeklySummary },
    error: null,
  });
}
