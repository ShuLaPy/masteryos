import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logAttemptAndUpdateMastery } from "@/lib/dsa-planner";
import type { Difficulty, AttemptOutcome } from "@/lib/pattern-rating";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const {
    problemId,
    patterns,
    difficulty,
    outcome,
    timeSeconds,
    usedHints,
    patternIdentified,
  }: {
    problemId?: string;
    patterns: string[];
    difficulty: Difficulty;
    outcome: AttemptOutcome;
    timeSeconds?: number;
    usedHints?: boolean;
    patternIdentified?: string;
  } = body;

  if (!patterns?.length || !difficulty || !outcome) {
    return Response.json({ data: null, error: "Missing required fields" }, { status: 400 });
  }

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
    problemId ?? null,
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
