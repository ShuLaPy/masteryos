import { createClient } from "@/lib/supabase/server";
import { complete } from "@/lib/ai-router";
import {
  targetDistribution,
  actualDistribution,
  computeDrift,
  patternPriority,
  type MasterySnapshot,
} from "@/lib/dsa-coach";
import {
  zpdTarget,
  problemSignal,
  scoreProblemFit,
  DEFAULT_TARGET_SUCCESS,
  type ZpdTarget,
} from "@/lib/zpd";
import {
  computeGlobalSkill,
  effectiveRating,
  type SkillLevelState,
} from "@/lib/skill-level";
import { CANONICAL_PATTERNS, type CanonicalPattern } from "@/lib/pattern-map";
import { weaknessFromMastery } from "@/lib/pattern-rating";

/**
 * GET /api/dsa/suggest — problem_bank RAG suggestion (spec §9).
 *
 * Pipeline:
 *   1. Load pattern_mastery, recent attempts, and solved-problem URLs.
 *   2. Coach: compute target/actual distributions → neglected patterns.
 *      Target patterns = neglected ∪ top-5 weakest, deduplicated, max 5.
 *   3. ZPD difficulty per target pattern.
 *   4. Filter problem_bank: patterns overlap with target_patterns AND matching
 *      ZPD difficulty AND leetcode_url NOT in user's solved set.
 *      Score by patternPriority; cap candidate set at 20 for LLM context.
 *   5. LLM ranks 3–5 candidates and writes one-line rationale per problem.
 *      Slugs are validated against the candidate set — hallucinated slugs are
 *      silently dropped. The bank guarantees every returned problem is real.
 *   6. Return { data: { suggestions }, error }.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // ── 1. Parallel data fetch ─────────────────────────────────────────────────
  const cutoff14d = new Date(Date.now() - 14 * 86_400_000).toISOString();

  const [masteryRes, attemptsRes, solvedRes, bankRes, settingsRes] = await Promise.all([
    supabase
      .from("pattern_mastery")
      .select("pattern, rating, rd, attempts")
      .eq("user_id", user.id),
    supabase
      .from("problem_attempts")
      .select("patterns, created_at")
      .eq("user_id", user.id)
      .gte("created_at", cutoff14d),
    supabase
      .from("dsa_problems")
      .select("url")
      .eq("user_id", user.id),
    supabase
      .from("problem_bank")
      .select(
        "id, slug, title, difficulty, patterns, leetcode_url, elo_rating, acceptance_rate",
      ),
    supabase.from("users").select("settings").eq("id", user.id).single(),
  ]);

  const fetchErr =
    masteryRes.error ??
    attemptsRes.error ??
    solvedRes.error ??
    bankRes.error;

  if (fetchErr) {
    return Response.json(
      { data: null, error: `Failed to load data: ${fetchErr.message}` },
      { status: 500 },
    );
  }

  // ── 2. Mastery map + coach computation ─────────────────────────────────────
  const masteryByPattern = new Map<CanonicalPattern, MasterySnapshot>(
    (masteryRes.data ?? []).map((r) => [
      r.pattern as CanonicalPattern,
      { rating: r.rating, rd: r.rd },
    ]),
  );

  const defaultMastery = (p: CanonicalPattern): MasterySnapshot =>
    masteryByPattern.get(p) ?? { rating: 1500, rd: 350 };

  // Global skill drives rd-adaptive ZPD targets + cold-start transfer.
  const settings = (settingsRes.data?.settings ?? {}) as Record<string, unknown>;
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
  const globalSkill = computeGlobalSkill(masteryRes.data ?? [], { previousLevel });
  const zpdTargetFor = (p: CanonicalPattern): ZpdTarget =>
    zpdTarget(
      effectiveRating(defaultMastery(p), globalSkill.globalRating, globalSkill.globalRd),
      { baseTargetSuccess },
    );

  const target = targetDistribution(masteryByPattern);
  const actual = actualDistribution(attemptsRes.data ?? [], 14, Date.now());
  const { neglected, overPracticed } = computeDrift(target, actual);

  // Weak patterns — top-5 by weakness score, independent of coverage drift
  const weakPatterns = CANONICAL_PATTERNS.slice()
    .map((p) => ({
      p,
      weakness: weaknessFromMastery(defaultMastery(p).rating, defaultMastery(p).rd),
    }))
    .sort((a, b) => b.weakness - a.weakness)
    .slice(0, 5)
    .map((x) => x.p);

  // Target = neglected ∪ weak, deduplicated, capped at 5
  const seen = new Set<string>();
  const targetPatterns: CanonicalPattern[] = [];
  for (const p of [...neglected, ...weakPatterns]) {
    if (!seen.has(p) && targetPatterns.length < 5) {
      seen.add(p);
      targetPatterns.push(p as CanonicalPattern);
    }
  }

  if (targetPatterns.length === 0) {
    return Response.json({ data: { suggestions: [] }, error: null });
  }

  // ── 3. ZPD target per target pattern (rd-adaptive, success-targeted) ───────
  const zpdTargetByPattern = new Map<string, ZpdTarget>(
    targetPatterns.map((p) => [p, zpdTargetFor(p)]),
  );

  // ── 4. Build and score the candidate set ───────────────────────────────────
  const targetPatternSet = new Set<string>(targetPatterns);

  // URLs of problems the user has already solved — excluded from suggestions
  const solvedUrls = new Set<string>(
    (solvedRes.data ?? [])
      .map((r) => r.url)
      .filter((u): u is string => typeof u === "string"),
  );

  type Candidate = {
    slug: string;
    title: string;
    difficulty: string;
    patterns: string[];
    leetcode_url: string;
    target_pattern: string;
    score: number;
  };

  const candidates: Candidate[] = (bankRes.data ?? [])
    .flatMap((b): Candidate[] => {
      // Already solved
      if (b.leetcode_url && solvedUrls.has(b.leetcode_url)) return [];

      const overlapPatterns = ((b.patterns as string[] | null) ?? []).filter(
        (p) => targetPatternSet.has(p),
      );
      if (overlapPatterns.length === 0) return [];

      // Continuous difficulty fit (real Elo → acceptance pseudo-Elo → categorical)
      // replaces the brittle bucket-equality filter. Score = patternPriority ×
      // how close the problem sits to the pattern's ZPD difficulty target.
      const signal = problemSignal(b);

      let bestPat = overlapPatterns[0];
      let bestScore = 0;
      for (const p of overlapPatterns) {
        const cp = p as CanonicalPattern;
        const gap = Math.max(
          0,
          (target.get(cp) ?? 0) - (actual.get(p) ?? 0),
        );
        const pp = patternPriority(defaultMastery(cp), cp, gap);
        const tgt = zpdTargetByPattern.get(p);
        const fit = tgt ? scoreProblemFit(signal, tgt) : 0;
        const combined = pp * fit;
        if (combined > bestScore) { bestScore = combined; bestPat = p; }
      }

      if (bestScore === 0) return [];

      return [
        {
          slug: b.slug,
          title: b.title,
          difficulty: b.difficulty,
          patterns: (b.patterns as string[] | null) ?? [],
          leetcode_url: b.leetcode_url,
          target_pattern: bestPat,
          score: bestScore,
        },
      ];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 20); // cap at 20 so the LLM context stays manageable

  if (candidates.length === 0) {
    return Response.json({ data: { suggestions: [] }, error: null });
  }

  // ── 5. Build LLM context ───────────────────────────────────────────────────
  const masteryLines = targetPatterns
    .map((p) => {
      const m = defaultMastery(p);
      const w = weaknessFromMastery(m.rating, m.rd).toFixed(2);
      const zpd = zpdTargetByPattern.get(p)?.band ?? "medium";
      const tag = neglected.includes(p) ? " [NEGLECTED]" : "";
      return `  ${p}: rating=${Math.round(m.rating)}, weakness=${w}, zpd_difficulty=${zpd}${tag}`;
    })
    .join("\n");

  const contextStr = [
    "Target patterns (weak or neglected):",
    masteryLines,
    `Coach: neglected=[${neglected.join(", ")}], over_practiced=[${overPracticed.join(", ")}]`,
  ].join("\n");

  const candidateLines = candidates
    .map(
      (c, i) =>
        `${i + 1}. slug="${c.slug}" | "${c.title}" | difficulty=${c.difficulty} | patterns=[${c.patterns.join(",")}]`,
    )
    .join("\n");

  // ── 6. LLM ranking call ────────────────────────────────────────────────────
  const SYSTEM_PROMPT = `You are a DSA coaching assistant. Your job is to select and rank the best 3–5 practice problems for a learner from a provided candidate list.

STRICT RULES — violation invalidates the output:
- You may ONLY return slugs that appear verbatim in the candidate list. Never invent or modify slugs.
- Write exactly one short rationale per problem (≤ 20 words), referencing the learner's actual weakness (pattern name, rating, or recency).
- Return valid JSON only: { "ranked": [{ "slug": string, "rationale": string }] }
- Include 3 to 5 items. If fewer than 3 candidates exist, return all of them.`;

  const USER_PROMPT = `Learner mastery context:
${contextStr}

Candidates (you MUST only pick slugs from this list):
${candidateLines}

Select and rank the 3–5 best next problems. For each, write one line of rationale that references the learner's specific weakness.`;

  interface LLMRanked {
    ranked: Array<{ slug: string; rationale: string }>;
  }

  const { data: completionData, error: llmError } = await complete({
    task: "problem_selection",
    systemPrompt:
      SYSTEM_PROMPT +
      "\n\nIMPORTANT: Respond with ONLY valid JSON, no markdown, no explanation, no code blocks.",
    messages: [{ role: "user", content: USER_PROMPT }],
  });

  if (llmError || !completionData) {
    return Response.json(
      { data: null, error: llmError ?? "LLM failed" },
      { status: 500 },
    );
  }

  let llmResult: LLMRanked | null = null;
  try {
    llmResult = JSON.parse(completionData.content) as LLMRanked;
  } catch {
    return Response.json(
      { data: null, error: "LLM returned invalid JSON" },
      { status: 500 },
    );
  }

  if (!llmResult?.ranked) {
    return Response.json(
      { data: null, error: "LLM returned no ranked results" },
      { status: 500 },
    );
  }

  // ── 7. Validate slugs — drop any hallucinated by the LLM ─────────────────
  const candidateBySlug = new Map(candidates.map((c) => [c.slug, c]));

  interface Suggestion {
    slug: string;
    title: string;
    difficulty: string;
    url: string;
    patterns: string[];
    target_pattern: string;
    rationale: string;
  }

  const suggestions: Suggestion[] = llmResult.ranked
    .filter(
      (r) =>
        r !== null &&
        typeof r === "object" &&
        typeof r.slug === "string" &&
        typeof r.rationale === "string" &&
        r.slug.length > 0,
    )
    .flatMap((r) => {
      const c = candidateBySlug.get(r.slug);
      if (!c) return []; // slug not in candidate set — LLM invented it, drop silently
      return [
        {
          slug: c.slug,
          title: c.title,
          difficulty: c.difficulty,
          url: c.leetcode_url,
          patterns: c.patterns,
          target_pattern: c.target_pattern,
          rationale: r.rationale.trim(),
        },
      ];
    })
    .slice(0, 5);

  return Response.json({ data: { suggestions }, error: null });
}
