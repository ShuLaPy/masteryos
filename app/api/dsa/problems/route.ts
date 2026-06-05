import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateJSON } from "@/lib/openai";
import { newCard, fsrsCardToDB } from "@/lib/fsrs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { title, url, difficulty, patterns, approach_notes, time_taken_minutes, confidence } = body;

  if (!title) return Response.json({ error: "Title is required" }, { status: 400 });

  // 1. Insert Problem
  const { data: problem, error: probError } = await supabase
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

  if (probError || !problem) {
    return Response.json({ error: "Failed to save problem" }, { status: 500 });
  }

  // 2. Generate generic pattern flashcards if they don't exist
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

  return Response.json({ success: true, problem, cards_generated: cardsGenerated });
}
