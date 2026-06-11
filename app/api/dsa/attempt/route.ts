import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logAttemptAndUpdateMastery } from "@/lib/dsa-planner";
import { isAttemptOutcome, isDifficulty } from "@/lib/pattern-rating";
import { CANONICAL_PATTERNS } from "@/lib/pattern-map";

const CANONICAL_SET = new Set<string>(CANONICAL_PATTERNS);

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ data: null, error: "Invalid JSON body" }, { status: 400 });
  }

  const { outcome, difficulty } = body;

  // The outcome and difficulty feed outcomeToScore / difficultyToRating —
  // unvalidated values fall through their switches as undefined and would
  // poison pattern_mastery with NaN. Reject anything off the closed enums.
  if (!isAttemptOutcome(outcome)) {
    return Response.json({ data: null, error: "Invalid outcome" }, { status: 400 });
  }
  if (!isDifficulty(difficulty)) {
    return Response.json({ data: null, error: "Invalid difficulty" }, { status: 400 });
  }

  const rawPatterns = Array.isArray(body.patterns) ? body.patterns : [];
  const patterns = [
    ...new Set(
      rawPatterns.filter(
        (p): p is string => typeof p === "string" && CANONICAL_SET.has(p),
      ),
    ),
  ];
  if (patterns.length === 0) {
    return Response.json(
      { data: null, error: "No canonical patterns in attempt" },
      { status: 400 },
    );
  }

  const problemId = typeof body.problemId === "string" ? body.problemId : null;
  const timeSeconds =
    typeof body.timeSeconds === "number" &&
    Number.isFinite(body.timeSeconds) &&
    body.timeSeconds >= 0
      ? body.timeSeconds
      : undefined;
  const usedHints = typeof body.usedHints === "boolean" ? body.usedHints : undefined;
  const patternIdentified =
    typeof body.patternIdentified === "string" ? body.patternIdentified : undefined;

  // Resolve a curated per-problem Elo (problem_bank.elo_rating) for a sharper
  // Glicko update. Linked via the solved problem's URL → bank.leetcode_url.
  // No-op until the bank is backfilled (elo_rating is NULL) — falls back to the
  // categorical difficulty centre inside logAttemptAndUpdateMastery.
  let problemElo: number | undefined;
  if (problemId) {
    const { data: prob } = await supabase
      .from("dsa_problems")
      .select("url")
      .eq("id", problemId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (prob?.url) {
      const { data: bank } = await supabase
        .from("problem_bank")
        .select("elo_rating")
        .eq("leetcode_url", prob.url)
        .maybeSingle();
      if (bank?.elo_rating != null) problemElo = bank.elo_rating;
    }
  }

  const { data, error } = await logAttemptAndUpdateMastery(
    supabase,
    user.id,
    problemId,
    patterns,
    difficulty,
    outcome,
    { timeSeconds, usedHints, patternIdentified, problemElo },
  );

  if (error) {
    return Response.json({ data: null, error }, { status: 500 });
  }

  return Response.json({ data: { updated: data!.updated }, error: null });
}
