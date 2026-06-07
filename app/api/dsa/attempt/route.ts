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

  const { data, error } = await logAttemptAndUpdateMastery(
    supabase,
    user.id,
    problemId ?? null,
    patterns,
    difficulty,
    outcome,
    { timeSeconds, usedHints, patternIdentified },
  );

  if (error) {
    return Response.json({ data: null, error }, { status: 500 });
  }

  return Response.json({ data: { updated: data!.updated }, error: null });
}
