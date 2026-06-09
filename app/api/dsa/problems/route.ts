import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateJSON, generateEmbedding } from "@/lib/openai";
import { newCard, fsrsCardToDB } from "@/lib/fsrs";
import { logAttemptAndUpdateMastery } from "@/lib/dsa-planner";
import type { Difficulty, AttemptOutcome } from "@/lib/pattern-rating";
import { normalizePatterns, DISPLAY_TO_CANONICAL } from "@/lib/constants";
import { fetchLeetCodeProblem, extractLCSlug } from "@/lib/leetcode";
import crypto from "crypto";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { title, url, difficulty, approach_notes, time_taken_minutes, confidence } = body;
  // Normalize patterns to deduplicated DSA_PATTERNS display names
  const patterns: string[] = normalizePatterns(body.patterns ?? []);

  if (!title) return Response.json({ error: "Title is required" }, { status: 400 });

  // 1. Check for an existing dsa_problems row for this (user, url) pair.
  //    If found, reuse it so we never create duplicates.
  let problem: { id: string; [key: string]: unknown } | undefined;
  let isNew = false;

  if (url) {
    const { data: existing } = await supabase
      .from("dsa_problems")
      .select("id")
      .eq("user_id", user.id)
      .eq("url", url)
      .maybeSingle();

    if (existing) {
      problem = existing;
    } else {
      isNew = true;
    }
  } else {
    isNew = true;
  }

  if (isNew) {
    const { data: inserted, error: probError } = await supabase
      .from("dsa_problems")
      .insert({
        user_id: user.id,
        title,
        url,
        difficulty,
        patterns,
        approach_notes,
        time_taken_minutes,
        confidence,
        source: "manual",
      })
      .select()
      .single();

    if (probError || !inserted) {
      return Response.json({ error: "Failed to save problem" }, { status: 500 });
    }
    problem = inserted;
  }

  if (!problem) {
    return Response.json({ error: "Failed to resolve problem record" }, { status: 500 });
  }

  // 2. Log attempt and update pattern mastery (Glicko-2)
  if (patterns.length > 0) {
    // Convert display names to canonical snake_case for the mastery engine
    const canonicalPatterns = [...new Set(
      patterns.map((p) => DISPLAY_TO_CANONICAL[p]).filter(Boolean) as string[],
    )];

    if (canonicalPatterns.length > 0) {
      const validDifficulties: Difficulty[] = ["easy", "medium", "hard"];
      const resolvedDifficulty: Difficulty = validDifficulties.includes(difficulty as Difficulty)
        ? (difficulty as Difficulty)
        : "medium";

      const conf = typeof confidence === "number" ? confidence : parseInt(confidence ?? "3");
      const outcome: AttemptOutcome =
        conf >= 5 ? "solved_fast"
        : conf === 4 ? "solved_effort"
        : conf === 3 ? "solved_effort"
        : conf === 2 ? "solved_hint"
        : "solved_after_approach";

      await logAttemptAndUpdateMastery(
        supabase,
        user.id,
        problem.id,
        canonicalPatterns,
        resolvedDifficulty,
        outcome,
        { timeSeconds: time_taken_minutes ? time_taken_minutes * 60 : undefined },
      );
    }
  }

  // 2b. Create a re-solve ladder card (single card per problem; the rung
  // escalates with reps in Daily Review — see ResolveLadderCard). Scoped to
  // medium/hard problems per spec §5.3. Idempotent: skip if one already exists.
  const resolveDifficulty = (difficulty ?? "").toLowerCase();
  if (resolveDifficulty === "medium" || resolveDifficulty === "hard") {
    const { data: existingResolve } = await supabase
      .from("srs_cards")
      .select("id")
      .eq("user_id", user.id)
      .eq("source_type", "dsa_resolve")
      .eq("source_id", problem.id)
      .limit(1);

    if (!existingResolve || existingResolve.length === 0) {
      await supabase.from("srs_cards").insert({
        user_id: user.id,
        card_type: "resolve",
        front: title,
        back: "Re-solve ladder — recall the insight, sketch the approach, then re-solve.",
        source_type: "dsa_resolve",
        source_id: problem.id,
        ...fsrsCardToDB(newCard()),
      });
    }
  }

  // 3. Generate generic pattern flashcards if they don't exist
  let cardsGenerated = 0;
  if (patterns && patterns.length > 0) {
    // See if user already has cards for these patterns
    const { data: existing } = await supabase
      .from("srs_cards")
      .select("front")
      .eq("user_id", user.id)
      .eq("source_type", "dsa_problem")
      .in("card_type", ["pattern"]);

    const existingText = existing?.map((c) => c.front.toLowerCase()) || [];

    for (const pattern of patterns) {
      // If we don't already have a generic structural card for this pattern
      if (!existingText.some((t) => t.includes(pattern.toLowerCase()))) {
        const prompt = `Create exactly 2 spaced repetition flashcards for the DSA pattern "${pattern}".
Card 1: Ask what the fundamental structure/template of the pattern is.
Card 2: Ask how to recognize when a problem requires this pattern.
Respond ONLY with a JSON object containing a single key "cards" which is an array of objects, with "front" and "back" string fields.`;

        const { data: result } = await generateJSON<{ cards: { front: string; back: string }[] }>(
          "You are an expert algorithms tutor.",
          prompt
        );

        if (result?.cards && Array.isArray(result.cards)) {
          const dbCards = result.cards.map((c) => ({
            user_id: user.id,
            card_type: "pattern",
            front: c.front,
            back: c.back,
            source_type: "dsa_problem",
            source_id: problem.id,
            ...fsrsCardToDB(newCard()),
          }));

          const { error: cardsErr } = await supabase.from("srs_cards").insert(dbCards);
          if (!cardsErr) cardsGenerated += dbCards.length;
        }
      }
    }
  }

  // 4. Fetch LeetCode question content and store it
  const lcSlug = extractLCSlug(url);
  if (lcSlug) {
    const lcData = await fetchLeetCodeProblem(lcSlug);
    if (lcData) {
      await supabase.from("dsa_problems").update({
        lc_content: lcData.content,
        lc_topic_tags: lcData.topicTags.map((t) => t.name),
        lc_hints: lcData.hints,
        lc_example_testcases: lcData.exampleTestcases,
      }).eq("id", problem.id);
    }
  }

  // 5. Generate embedding for semantic search (non-blocking)
  try {
    const embeddingContent = [title, difficulty ? `Difficulty: ${difficulty}` : "", patterns?.length ? `Patterns: ${patterns.join(", ")}` : "", approach_notes || ""].filter(Boolean).join("\n");
    if (embeddingContent.length >= 10) {
      const contentHash = crypto.createHash("sha256").update(embeddingContent).digest("hex");
      const { data: embedding } = await generateEmbedding(embeddingContent);
      if (embedding) {
        await supabase.from("concept_embeddings").insert({
          user_id: user.id,
          source_type: "dsa_problem",
          source_id: problem.id,
          content_hash: contentHash,
          embedding: JSON.stringify(embedding),
        });
      }
    }
  } catch {
    // Embedding generation failure shouldn't block problem creation
  }

  return Response.json({ success: true, problem, cards_generated: cardsGenerated });
}
