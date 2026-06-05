import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateJSON } from "@/lib/openai";
import { newCard, fsrsCardToDB } from "@/lib/fsrs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { title, week_number, concept_type, notes, tags, source } = body;

  if (!title) return Response.json({ error: "Title is required" }, { status: 400 });

  // 1. Insert Concept
  const { data: concept, error: conceptError } = await supabase
    .from("aiml_concepts")
    .insert({
      user_id: user.id,
      title,
      week_number,
      concept_type,
      notes,
      tags,
      source,
    })
    .select()
    .single();

  if (conceptError || !concept) {
    return Response.json({ error: "Failed to save concept" }, { status: 500 });
  }

  // 2. Generate SRS Cards using OpenAI
  let generatedCards = 0;
  if (notes && notes.length > 20) {
    const prompt = `You are an expert AI tutor. Based on the following concept notes, generate 3-5 flashcards for spaced repetition.
The cards should cover key definitions, intuitions, and common misconceptions.

Concept: ${title}
Notes: ${notes}

Respond ONLY with a JSON array of objects, where each object has "front" (the question/prompt) and "back" (the answer). Keep the answers concise and clear.`;

    const result = await generateJSON<{ front: string; back: string }[]>(
      "You generate SRS flashcards in JSON format.",
      prompt
    );

    if (result.data && Array.isArray(result.data)) {
      const dbCards = result.data.map((c) => {
        const defaultFsrs = newCard();
        return {
          user_id: user.id,
          card_type: "concept",
          front: c.front,
          back: c.back,
          source_type: "aiml_concept",
          source_id: concept.id,
          ...fsrsCardToDB(defaultFsrs),
        };
      });

      if (dbCards.length > 0) {
        const { error: cardsErr } = await supabase.from("srs_cards").insert(dbCards);
        if (!cardsErr) {
          generatedCards = dbCards.length;
        }
      }
    }
  }

  return Response.json({ success: true, concept, cards_generated: generatedCards });
}
