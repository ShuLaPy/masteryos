import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Code2, Sparkles, Brain, Building2, Target, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { complete } from "@/lib/ai-router";
import {
  targetDistribution,
  actualDistribution,
  computeDrift,
  balanceScore,
  type MasterySnapshot,
} from "@/lib/dsa-coach";
import {
  zpdTarget,
  problemSignal,
  scoreProblemFit,
  DEFAULT_TARGET_SUCCESS,
} from "@/lib/zpd";
import {
  computeGlobalSkill,
  effectiveRating,
  type SkillLevelState,
} from "@/lib/skill-level";
import { currentRd, weaknessFromMastery } from "@/lib/pattern-rating";
import { CANONICAL_PATTERNS, type CanonicalPattern } from "@/lib/pattern-map";
import PatternMasteryHeatmap from "@/components/app/dsa/PatternMasteryHeatmap";
import DsaCoachCard from "@/components/app/dsa/DsaCoachCard";
import SuggestedProblemList from "@/components/app/dsa/SuggestedProblemList";
import TrajectorySparkline from "@/components/app/dsa/TrajectorySparkline";
import WeeklySummaryStrip from "@/components/app/dsa/WeeklySummaryStrip";
import { BlindModeToggle } from "@/components/app/dsa/BlindModeToggle";

export const metadata = { title: "DSA Track — MasteryOS" };

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

export default async function DSATrackPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const cutoff14d = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const cutoff12w = new Date(Date.now() - 84 * 86_400_000).toISOString();

  const [masteryRes, attemptsCoachRes, attemptsTrajectoryRes, bankRes, solvedRes, countRes, allAttemptsRes, profileRes] =
    await Promise.all([
      supabase
        .from("pattern_mastery")
        .select("pattern, rating, rd, attempts, volatility, last_attempt_at")
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
        .select(
          "id, slug, title, difficulty, patterns, leetcode_url, elo_rating, acceptance_rate",
        ),
      supabase
        .from("dsa_problems")
        .select("id, url, patterns")
        .eq("user_id", user.id),
      supabase
        .from("srs_cards")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .in("source_type", ["dsa_recognition", "dsa_problem"]),
      supabase
        .from("problem_attempts")
        .select("patterns, difficulty, outcome_score, time_seconds, pattern_identified, created_at")
        .eq("user_id", user.id),
      supabase.from("users").select("settings").eq("id", user.id).single(),
    ]);

  const settings = (profileRes.data?.settings ?? {}) as Record<string, unknown>;
  const blindMode = settings.blind_mode === true;
  const baseTargetSuccess =
    typeof settings.zpd_target_success === "number" &&
    Number.isFinite(settings.zpd_target_success) &&
    settings.zpd_target_success > 0.5 &&
    settings.zpd_target_success < 0.95
      ? settings.zpd_target_success
      : DEFAULT_TARGET_SUCCESS;
  const previousLevel =
    settings.skill_level_cache === "beginner" ||
    settings.skill_level_cache === "intermediate" ||
    settings.skill_level_cache === "advanced" ||
    settings.skill_level_cache === "calibrating"
      ? (settings.skill_level_cache as SkillLevelState)
      : undefined;

  // Effective rd: read-time inactivity inflation — stale patterns display
  // elevated rd/weakness and feed the global skill with lower precision.
  const masteryRows = (masteryRes.data ?? []).map((r) => ({
    ...r,
    rd: currentRd(r.rd, r.volatility, r.last_attempt_at),
  }));

  // ── Global skill (level + weighted rating) ──────────────────────────────────
  const globalSkill = computeGlobalSkill(masteryRows, { previousLevel });

  // ── Mastery map ────────────────────────────────────────────────────────────
  const masteryByPattern = new Map<CanonicalPattern, MasterySnapshot>(
    masteryRows.map((r) => [
      r.pattern as CanonicalPattern,
      { rating: r.rating, rd: r.rd },
    ]),
  );
  const attemptsCountByPattern = new Map<string, number>(
    masteryRows.map((r) => [r.pattern, r.attempts]),
  );

  // ZPD band shown per pattern reflects rd-adaptive targeting + cold-start
  // transfer toward the user's global rating (matches what the planner selects).
  const zpdBand = (m: MasterySnapshot): string =>
    zpdTarget(
      effectiveRating(m, globalSkill.globalRating, globalSkill.globalRd),
      { baseTargetSuccess },
    ).band;

  const patterns = CANONICAL_PATTERNS.map((p) => {
    const m = masteryByPattern.get(p) ?? { rating: DEFAULT_RATING, rd: DEFAULT_RD };
    return {
      pattern: p,
      rating: m.rating,
      rd: m.rd,
      attempts: attemptsCountByPattern.get(p) ?? 0,
      weakness: weaknessFromMastery(m.rating, m.rd),
      zpd_difficulty: zpdBand(m),
    };
  });

  // ── Trajectory ─────────────────────────────────────────────────────────────
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

  // ── Coach drift ────────────────────────────────────────────────────────────
  const target = targetDistribution(masteryByPattern);
  const actual = actualDistribution(attemptsCoachRes.data ?? [], 14, Date.now());
  const { neglected, overPracticed } = computeDrift(target, actual);
  const coach = {
    neglected,
    over_practiced: overPracticed,
    balance_score: Math.round(balanceScore(target, actual) * 100) / 100,
  };

  // ── ZPD suggestions ────────────────────────────────────────────────────────
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

  const suggestions: Array<{
    slug: string;
    title: string;
    difficulty: string;
    url: string;
    patterns: string[];
    target_pattern: string;
  }> = [];
  const usedSlugs = new Set<string>();
  for (const tp of topPatterns) {
    const m = masteryByPattern.get(tp) ?? { rating: DEFAULT_RATING, rd: DEFAULT_RD };
    const target = zpdTarget(
      effectiveRating(m, globalSkill.globalRating, globalSkill.globalRd),
      { baseTargetSuccess },
    );
    // Best-fit unsolved bank problem in this pattern (continuous, not bucket-exact).
    type BankRow = NonNullable<typeof bankRes.data>[number];
    let best: BankRow | null = null;
    let bestFit = 0;
    for (const b of bankRes.data ?? []) {
      if (usedSlugs.has(b.slug)) continue;
      if (b.leetcode_url && solvedUrls.has(b.leetcode_url)) continue;
      if (!((b.patterns as string[]) ?? []).includes(tp)) continue;
      const fit = scoreProblemFit(problemSignal(b), target);
      if (fit > bestFit) {
        bestFit = fit;
        best = b;
      }
    }
    if (best) {
      usedSlugs.add(best.slug);
      suggestions.push({
        slug: best.slug,
        title: best.title,
        difficulty: best.difficulty,
        url: best.leetcode_url,
        patterns: (best.patterns as string[]) ?? [],
        target_pattern: tp,
      });
    }
  }

  // ── AI brief (server-side, narrative only) ─────────────────────────────────
  const trajectoryDir =
    trajectory.length >= 2
      ? trajectory[trajectory.length - 1].avg_score >
        trajectory[trajectory.length - 2].avg_score
        ? "improving"
        : "declining"
      : "stable";

  const topWeak = patterns
    .filter((p) => p.attempts > 0)
    .sort((a, b) => b.weakness - a.weakness)
    .slice(0, 3)
    .map((p) => `${p.pattern}(${Math.round(p.rating)})`);

  const briefContext = [
    `Balance: ${coach.balance_score}. Neglected: ${coach.neglected.join(", ") || "none"}.`,
    `Over-practiced: ${coach.over_practiced.join(", ") || "none"}.`,
    `Weakest: ${topWeak.join(", ") || "none attempted"}.`,
    `Trend: ${trajectoryDir}. Patterns attempted: ${patterns.filter((p) => p.attempts > 0).length}/25.`,
  ].join(" ");

  const { data: briefData } = await complete({
    task: "coaching_synthesis",
    systemPrompt:
      "You are a concise DSA coach. Write a 3-sentence daily brief based only on the stats given. " +
      "Sentence 1: portfolio balance. " +
      "Sentence 2: which patterns to focus on today and why. " +
      "Sentence 3: motivation referencing their trend. " +
      "Under 70 words. Plain text, no markdown.",
    messages: [
      {
        role: "user",
        content: `Stats: ${briefContext}\n\nWrite the brief.`,
      },
    ],
  });

  const brief =
    briefData?.content ??
    "Keep grinding — consistent, balanced practice across all 25 patterns builds lasting mastery.";

  // ── Weekly summary metrics (§14) ──────────────────────────────────────────
  // Precision-weighted global rating + mastered breadth (confident patterns only)
  // replace the old naive mean over all 25 patterns (which an unattended pattern
  // dragged toward 1500).
  const avgRating = Math.round(globalSkill.globalRating);
  const breadth = globalSkill.breadthMastered;

  const DIFFICULTY_ORDER = { easy: 1, medium: 2, hard: 3 } as const;
  type DifficultyKey = keyof typeof DIFFICULTY_ORDER;

  const ceilingByPattern = new Map<string, DifficultyKey>();
  for (const a of allAttemptsRes.data ?? []) {
    if (a.outcome_score >= 0.5 && a.difficulty in DIFFICULTY_ORDER) {
      const diff = a.difficulty as DifficultyKey;
      const rank = DIFFICULTY_ORDER[diff];
      for (const pat of (a.patterns as string[])) {
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
    level: globalSkill.level,
    breadth,
    difficulty_ceiling: difficultyCeiling,
    median_time_to_insight_seconds: medianTimeToInsightSeconds,
    balance_score: coach.balance_score,
    recognition_accuracy_pct: recognitionAccuracyPct,
  };

  // ── Page stats ─────────────────────────────────────────────────────────────
  const totalProblems = solvedRes.data?.length ?? 0;
  const totalCards = countRes.count ?? 0;

  // pattern_mastery is always updated when a problem is logged, so it's the ground truth.
  // dsa_problems.patterns stores display names ("Two Pointers") while pattern_mastery uses
  // canonical snake_case ("two_pointers") — mixing both in a Set doubles the count.
  const exploredPatterns = patterns.filter((p) => p.attempts > 0).length;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Code2 className="w-6 h-6 text-emerald-400" /> DSA Track
            <span
              className="ml-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-primary/15 text-primary border border-primary/25"
              title={`Global Glicko-2 rating ${Math.round(globalSkill.globalRating)} · confidence ${Math.round(globalSkill.confidence * 100)}% · ${globalSkill.breadthAttempted}/25 patterns practiced`}
            >
              {globalSkill.level === "calibrating"
                ? "Calibrating…"
                : `${globalSkill.level[0].toUpperCase()}${globalSkill.level.slice(1)} · ${Math.round(globalSkill.globalRating)}`}
            </span>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Pattern mastery · Glicko-2 ratings · ZPD suggestions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BlindModeToggle initialValue={blindMode} />
          <Link href="/dsa/log">
            <Button className="bg-emerald-500 hover:bg-emerald-600 text-white">
              <Plus className="w-4 h-4 mr-2" /> Log Problem
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        <div className="glass rounded-xl p-4">
          <p className="text-2xl font-bold text-foreground">{totalProblems}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Problems solved</p>
        </div>
        <div className="glass rounded-xl p-4">
          <p className="text-2xl font-bold text-foreground">{totalCards}</p>
          <p className="text-xs text-muted-foreground mt-0.5">SRS cards</p>
        </div>
        <div className="glass rounded-xl p-4">
          <p className="text-2xl font-bold text-emerald-400">
            {exploredPatterns} / 25
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Patterns explored</p>
        </div>
        <div className="glass rounded-xl p-4">
          <p
            className={`text-2xl font-bold ${
              coach.balance_score >= 0.85
                ? "text-emerald-400"
                : coach.balance_score >= 0.65
                  ? "text-amber-400"
                  : "text-red-400"
            }`}
          >
            {coach.balance_score.toFixed(2)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Balance score</p>
        </div>
      </div>

      {/* AI Brief */}
      <div className="glass rounded-xl p-4 border-primary/20 border flex gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
          <Sparkles className="w-4 h-4 text-primary" />
        </div>
        <div>
          <p className="text-xs font-medium text-primary mb-1 uppercase tracking-wider">
            Coach · Daily Brief
          </p>
          <p className="text-sm text-foreground/90 leading-relaxed">{brief}</p>
        </div>
      </div>

      {/* Weekly summary strip */}
      <WeeklySummaryStrip summary={weeklySummary} />

      {/* Heatmap + Coach side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 glass rounded-xl p-4">
          <PatternMasteryHeatmap patterns={patterns} />
        </div>
        <div className="lg:col-span-1">
          <DsaCoachCard coach={coach} />
        </div>
      </div>

      {/* Trajectory sparkline */}
      <TrajectorySparkline trajectory={trajectory} />

      {/* Suggestions */}
      <SuggestedProblemList suggestions={suggestions} />

      {/* Bottom links */}
      <div className="flex items-center justify-center gap-6 pt-2">
        <Link
          href="/dsa/problems"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
        >
          <Brain className="w-3.5 h-3.5" />
          Browse all logged problems
        </Link>
        <span className="text-border">·</span>
        <Link
          href="/dsa/company-practice"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-violet-400 transition-colors"
        >
          <Building2 className="w-3.5 h-3.5" />
          Company practice session
        </Link>
        <span className="text-border">·</span>
        <Link
          href="/dsa/drill"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-violet-400 transition-colors"
        >
          <Target className="w-3.5 h-3.5" />
          Pattern drill
        </Link>
        <span className="text-border">·</span>
        <Link
          href="/dsa/competition"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-amber-400 transition-colors"
        >
          <Trophy className="w-3.5 h-3.5" />
          Weekly competition
        </Link>
      </div>
    </div>
  );
}
