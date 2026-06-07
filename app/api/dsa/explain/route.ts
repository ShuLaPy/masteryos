import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete } from "@/lib/ai-router";
import type { Database } from "@/types/database";

type DsaProblemBase = Database["public"]["Tables"]["dsa_problems"]["Row"];
type DsaProblemEnriched = DsaProblemBase & {
  ai_explanation: string | null;
  ai_explanation_generated_at: string | null;
  ai_explanation_model: string | null;
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const SYSTEM_PROMPT = `You are helping an AIML/DSA student create a quick-revision blueprint for a LeetCode problem. Write a clear, concise article they can read in 2 minutes to fully recall how to solve it.`;

function buildUserMessage(problem: DsaProblemEnriched, primaryPattern: string): string {
  return `Problem: ${problem.title} (${problem.difficulty ?? "unknown"})
Primary Pattern: ${primaryPattern}
URL: ${problem.url ?? "N/A"}

Structure EXACTLY as follows (use these exact markdown headings):

## Pattern Signal
2-3 sentences. What clues in the problem statement — constraints, phrasing, or structure — tell an experienced solver which pattern to reach for?

## Brute Force
The naive approach in plain English. Why is it insufficient?
Time: O(?) Space: O(?)

## The Insight
One short paragraph. The single key realization that unlocks the optimal solution. This is the "aha" moment.

## Optimal Approach
Step-by-step walkthrough of the algorithm. Use a small concrete example. Keep it tight — 5-8 steps maximum.
Time: O(?) Space: O(?)

## Detection Checklist
3-5 bullet points. Given a new problem, what signals tell you this same pattern applies? Make these generic enough to transfer to unseen problems.

## Watch Out For
2-3 common mistakes or edge cases that trip people up on this problem.

Write for a student who solved this problem once but wants to lock in the mental model for interviews.`;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = (await request.json()) as { problemId?: string; force?: boolean };
  if (!body.problemId) {
    return Response.json({ data: null, error: "Missing problemId" }, { status: 400 });
  }

  const { data: problem, error: problemErr } = await supabase
    .from("dsa_problems")
    .select("*")
    .eq("id", body.problemId)
    .eq("user_id", user.id)
    .single();

  if (problemErr || !problem) {
    return Response.json({ data: null, error: "Problem not found" }, { status: 404 });
  }

  const row = problem as unknown as DsaProblemEnriched;

  // Return cached explanation if fresh and not force-regenerating
  if (!body.force && row.ai_explanation && row.ai_explanation_generated_at) {
    const age = Date.now() - new Date(row.ai_explanation_generated_at).getTime();
    if (age < THIRTY_DAYS_MS) {
      return Response.json({
        data: { explanation: row.ai_explanation, cached: true },
        error: null,
      });
    }
  }

  // Resolve primary pattern — prefer problem_bank over dsa_problems
  let primaryPattern = row.patterns?.[0] ?? "General";
  if (row.url) {
    try {
      const slug = new URL(row.url).pathname.split("/").filter(Boolean)[1];
      if (slug) {
        const { data: bankRow } = await supabase
          .from("problem_bank")
          .select("patterns")
          .eq("slug", slug)
          .maybeSingle();
        if (bankRow?.patterns?.[0]) primaryPattern = bankRow.patterns[0];
      }
    } catch {
      // URL parse failed — fall back to dsa_problems.patterns
    }
  }

  const { data: aiData, error: aiError } = await complete({
    task: "problem_selection",
    messages: [{ role: "user", content: buildUserMessage(row, primaryPattern) }],
    systemPrompt: SYSTEM_PROMPT,
  });

  if (aiError || !aiData) {
    return Response.json(
      { data: null, error: aiError ?? "AI generation failed" },
      { status: 500 }
    );
  }

  // Cache the result — log failure but still return the explanation
  const { error: updateErr } = await supabase
    .from("dsa_problems")
    .update({
      ai_explanation: aiData.content,
      ai_explanation_generated_at: new Date().toISOString(),
      ai_explanation_model: "gpt-5.4",
    } as Record<string, unknown>)
    .eq("id", body.problemId)
    .eq("user_id", user.id);

  if (updateErr) console.error("Failed to cache AI explanation:", updateErr.message);

  return Response.json({
    data: { explanation: aiData.content, cached: false },
    error: null,
  });
}
